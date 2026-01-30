#!/usr/bin/env python3
"""
Chessist - Native Messaging Host
Connects to local Stockfish installation for faster analysis.
Fresh Stockfish instance per evaluation for maximum reliability.
"""

import sys
import json
import struct
import subprocess
import threading
import os

# Try to find Stockfish in common locations
STOCKFISH_PATHS = [
    # Windows
    r"C:\Program Files\Stockfish\stockfish.exe",
    r"C:\Program Files (x86)\Stockfish\stockfish.exe",
    r"C:\stockfish\stockfish.exe",
    os.path.expanduser(r"~\stockfish\stockfish.exe"),
    # Linux/Mac
    "/usr/bin/stockfish",
    "/usr/local/bin/stockfish",
    "/opt/homebrew/bin/stockfish",
    os.path.expanduser("~/stockfish/stockfish"),
]

stockfish_path = None
stockfish_process = None
output_thread = None
stdout_lock = threading.Lock()
current_eval_fen = None
stop_requested = False


def find_stockfish():
    """Find Stockfish executable on the system."""
    env_path = os.environ.get("STOCKFISH_PATH")
    if env_path and os.path.isfile(env_path):
        return env_path

    for path in STOCKFISH_PATHS:
        if os.path.isfile(path):
            return path

    import shutil
    path = shutil.which("stockfish")
    if path:
        return path

    return None


def send_message(message):
    """Send a message to the extension (thread-safe)."""
    with stdout_lock:
        try:
            encoded = json.dumps(message).encode('utf-8')
            sys.stdout.buffer.write(struct.pack('I', len(encoded)))
            sys.stdout.buffer.write(encoded)
            sys.stdout.buffer.flush()
        except Exception:
            pass


def read_message():
    """Read a message from the extension."""
    try:
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length:
            return None
        length = struct.unpack('I', raw_length)[0]
        message = sys.stdin.buffer.read(length).decode('utf-8')
        return json.loads(message)
    except Exception:
        return None


def kill_stockfish():
    """Kill the current Stockfish process if running."""
    global stockfish_process, output_thread

    if stockfish_process:
        try:
            stockfish_process.stdin.write("quit\n")
            stockfish_process.stdin.flush()
        except Exception:
            pass

        try:
            stockfish_process.terminate()
            stockfish_process.wait(timeout=1)
        except Exception:
            try:
                stockfish_process.kill()
            except Exception:
                pass

        stockfish_process = None

    output_thread = None


def start_stockfish_and_analyze(fen, depth):
    """Start a fresh Stockfish instance and analyze the position."""
    global stockfish_process, output_thread, current_eval_fen, stop_requested

    # Kill any existing instance
    kill_stockfish()

    stop_requested = False
    current_eval_fen = fen

    try:
        stockfish_process = subprocess.Popen(
            [stockfish_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1
        )

        # Start output reader thread
        output_thread = threading.Thread(
            target=read_stockfish_output,
            args=(fen, depth),
            daemon=True
        )
        output_thread.start()

        # Initialize and start analysis
        stockfish_process.stdin.write("uci\n")
        stockfish_process.stdin.flush()

    except Exception as e:
        send_message({"type": "error", "message": f"Failed to start Stockfish: {str(e)}"})
        current_eval_fen = None


def read_stockfish_output(eval_fen, depth):
    """Read output from Stockfish and send to extension."""
    global stop_requested

    engine_ready = False

    while stockfish_process and stockfish_process.poll() is None:
        if stop_requested:
            break

        try:
            line = stockfish_process.stdout.readline()
            if not line:
                break

            line = line.strip()
            if not line:
                continue

            if line == "uciok":
                uci_ready = True
                # Configure engine
                stockfish_process.stdin.write("setoption name Threads value 4\n")
                stockfish_process.stdin.write("setoption name Hash value 128\n")
                stockfish_process.stdin.write("isready\n")
                stockfish_process.stdin.flush()

            elif line == "readyok":
                if not engine_ready:
                    engine_ready = True
                    send_message({"type": "ready"})

                    # Start analysis
                    send_message({"type": "analyzing", "fen": eval_fen[:50], "depth": depth})
                    stockfish_process.stdin.write(f"position fen {eval_fen}\n")
                    stockfish_process.stdin.write(f"go depth {depth}\n")
                    stockfish_process.stdin.flush()

            elif line.startswith("info depth"):
                if stop_requested:
                    break
                eval_data = parse_info(line)
                if eval_data and eval_data.get("depth", 0) >= 5:
                    send_message({"type": "eval", "data": eval_data})

            elif line.startswith("bestmove"):
                if stop_requested:
                    break
                parts = line.split()
                best_move = parts[1] if len(parts) > 1 else None
                send_message({"type": "bestmove", "move": best_move})
                break  # Analysis complete, exit thread

        except Exception as e:
            send_message({"type": "error", "message": f"Output error: {str(e)}"})
            break


def parse_info(line):
    """Parse Stockfish info line into evaluation data."""
    data = {}

    # Extract depth
    if "depth " in line:
        try:
            idx = line.index("depth ") + 6
            end = line.index(" ", idx) if " " in line[idx:] else len(line)
            data["depth"] = int(line[idx:end])
        except Exception:
            pass

    # Extract score
    if "score cp " in line:
        try:
            idx = line.index("score cp ") + 9
            end_idx = idx
            while end_idx < len(line) and (line[end_idx].isdigit() or line[end_idx] == '-'):
                end_idx += 1
            data["cp"] = int(line[idx:end_idx])
        except Exception:
            pass
    elif "score mate " in line:
        try:
            idx = line.index("score mate ") + 11
            end_idx = idx
            while end_idx < len(line) and (line[end_idx].isdigit() or line[end_idx] == '-'):
                end_idx += 1
            data["mate"] = int(line[idx:end_idx])
        except Exception:
            pass

    # Extract PV for best move
    if " pv " in line:
        try:
            idx = line.index(" pv ") + 4
            pv_moves = line[idx:].split()
            if pv_moves:
                data["bestMove"] = pv_moves[0]
        except Exception:
            pass

    # Extract nps
    if "nps " in line:
        try:
            idx = line.index("nps ") + 4
            end = line.index(" ", idx) if " " in line[idx:] else len(line)
            data["nps"] = int(line[idx:end])
        except Exception:
            pass

    return data if ("cp" in data or "mate" in data) else None


def main():
    global stockfish_path, stop_requested

    # Find Stockfish
    stockfish_path = find_stockfish()

    if not stockfish_path:
        send_message({
            "type": "error",
            "message": "Stockfish not found. Install Stockfish and add to PATH or set STOCKFISH_PATH."
        })
        return

    send_message({"type": "started", "path": stockfish_path})

    # Main message loop
    while True:
        try:
            message = read_message()
            if message is None:
                break

            msg_type = message.get("type")

            if msg_type == "evaluate":
                fen = message.get("fen")
                depth = message.get("depth", 18)
                if fen:
                    # Start fresh Stockfish for this evaluation
                    start_stockfish_and_analyze(fen, depth)

            elif msg_type == "stop":
                stop_requested = True
                kill_stockfish()

            elif msg_type == "reset":
                stop_requested = True
                kill_stockfish()
                send_message({"type": "debug", "message": "Engine reset (killed)"})

            elif msg_type == "quit":
                break

        except Exception as e:
            send_message({"type": "error", "message": str(e)})

    # Cleanup
    kill_stockfish()


if __name__ == "__main__":
    main()
