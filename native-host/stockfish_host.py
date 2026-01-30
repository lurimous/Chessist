#!/usr/bin/env python3
"""
Chessist - Native Messaging Host
Connects to local Stockfish installation for faster analysis.
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

stockfish_process = None
is_ready = False
pending_eval = None  # (fen, depth) tuple waiting for engine to be ready
current_analysis_fen = None  # FEN currently being analyzed
pending_lock = threading.Lock()  # Protect pending_eval access
stdin_lock = threading.Lock()  # Protect stdin writes from interleaving


def find_stockfish():
    """Find Stockfish executable on the system."""
    # Check environment variable first
    env_path = os.environ.get("STOCKFISH_PATH")
    if env_path and os.path.isfile(env_path):
        return env_path

    # Check common paths
    for path in STOCKFISH_PATHS:
        if os.path.isfile(path):
            return path

    # Try to find in PATH
    import shutil
    path = shutil.which("stockfish")
    if path:
        return path

    return None


def send_message(message):
    """Send a message to the extension."""
    encoded = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def read_message():
    """Read a message from the extension."""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    length = struct.unpack('I', raw_length)[0]
    message = sys.stdin.buffer.read(length).decode('utf-8')
    return json.loads(message)


def start_stockfish(path):
    """Start the Stockfish process."""
    global stockfish_process, is_ready

    try:
        stockfish_process = subprocess.Popen(
            [path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,  # Discard stderr to prevent pipe deadlock
            text=True,
            bufsize=1
        )

        # Start output reader thread
        threading.Thread(target=read_stockfish_output, daemon=True).start()

        # Initialize UCI
        send_command("uci")

        return True
    except Exception as e:
        send_message({"type": "error", "message": f"Failed to start Stockfish: {str(e)}"})
        return False


def read_stockfish_output():
    """Read output from Stockfish and send to extension."""
    global is_ready, pending_eval, current_analysis_fen

    while stockfish_process and stockfish_process.poll() is None:
        try:
            line = stockfish_process.stdout.readline()
            if not line:
                break

            line = line.strip()

            if line == "uciok":
                send_message({"type": "uciok"})
                send_command("isready")

            elif line == "readyok":
                is_ready = True
                send_message({"type": "debug", "message": "Received readyok from Stockfish"})

                # Check if there's a pending evaluation to start
                with pending_lock:
                    eval_to_run = pending_eval
                    pending_eval = None

                send_message({"type": "debug", "message": f"eval_to_run: {eval_to_run is not None}"})
                if eval_to_run:
                    fen, depth = eval_to_run
                    current_analysis_fen = fen  # Track what we're analyzing
                    send_message({"type": "analyzing", "fen": fen[:50], "depth": depth})
                    send_command(f"position fen {fen}")
                    send_command(f"go depth {depth}")
                else:
                    current_analysis_fen = None
                    send_message({"type": "ready"})

            elif line.startswith("info depth"):
                # Parse evaluation info
                eval_data = parse_info(line)
                if eval_data:
                    send_message({"type": "eval", "data": eval_data})

            elif line.startswith("bestmove"):
                parts = line.split()
                best_move = parts[1] if len(parts) > 1 else None
                send_message({"type": "debug", "message": f"Stockfish bestmove: {best_move}"})
                send_message({"type": "bestmove", "move": best_move})

        except Exception as e:
            send_message({"type": "error", "message": str(e)})
            break


def parse_info(line):
    """Parse Stockfish info line into evaluation data."""
    data = {}

    # Extract depth
    if "depth " in line:
        try:
            idx = line.index("depth ") + 6
            end = line.index(" ", idx)
            data["depth"] = int(line[idx:end])
        except:
            pass

    # Extract score
    if "score cp " in line:
        try:
            idx = line.index("score cp ") + 9
            end_idx = idx
            while end_idx < len(line) and (line[end_idx].isdigit() or line[end_idx] == '-'):
                end_idx += 1
            data["cp"] = int(line[idx:end_idx])
        except:
            pass
    elif "score mate " in line:
        try:
            idx = line.index("score mate ") + 11
            end_idx = idx
            while end_idx < len(line) and (line[end_idx].isdigit() or line[end_idx] == '-'):
                end_idx += 1
            data["mate"] = int(line[idx:end_idx])
        except:
            pass

    # Extract nodes per second
    if "nps " in line:
        try:
            idx = line.index("nps ") + 4
            end = line.index(" ", idx) if " " in line[idx:] else len(line)
            data["nps"] = int(line[idx:end])
        except:
            pass

    return data if ("cp" in data or "mate" in data) else None


def send_command(cmd):
    """Send a command to Stockfish."""
    if stockfish_process and stockfish_process.poll() is None:
        with stdin_lock:
            stockfish_process.stdin.write(cmd + "\n")
            stockfish_process.stdin.flush()


def main():
    global stockfish_process, pending_eval, current_analysis_fen

    # Find Stockfish
    stockfish_path = find_stockfish()

    if not stockfish_path:
        send_message({
            "type": "error",
            "message": "Stockfish not found. Please install Stockfish and add it to PATH or set STOCKFISH_PATH environment variable."
        })
        return

    # Start Stockfish
    if not start_stockfish(stockfish_path):
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
                    # Debug: log that we received the request
                    send_message({"type": "debug", "message": f"Received evaluate: {fen[:30]}..."})
                    # Store pending evaluation and stop current analysis
                    with pending_lock:
                        pending_eval = (fen, depth)
                    # Always send stop + isready to ensure engine responds
                    send_command("stop")
                    send_command("isready")

            elif msg_type == "stop":
                send_command("stop")

            elif msg_type == "set_option":
                name = message.get("name")
                value = message.get("value")
                if name and value is not None:
                    send_command(f"setoption name {name} value {value}")

            elif msg_type == "quit":
                send_command("quit")
                break

        except Exception as e:
            send_message({"type": "error", "message": str(e)})

    # Cleanup
    if stockfish_process:
        stockfish_process.terminate()


if __name__ == "__main__":
    main()
