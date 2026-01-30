# Evaluation Bar Display Logic

## Visual Explanation

### When Playing as WHITE:

```
Position: White is winning by +2.5
╔══════════════╗
║   WHITE      ║  ← 75% fill (white winning)
║   WINNING    ║
║              ║
║──────────────║  ← 50% line (equal)
║              ║
║              ║
║   black      ║  ← 25% fill from bottom
╚══════════════╝

Display: +2.5 (positive = you're winning!)
```

```
Position: White is losing by -1.8
╔══════════════╗
║   white      ║  ← 32% fill from top
║              ║
║              ║
║──────────────║  ← 50% line (equal)
║              ║
║   BLACK      ║
║   WINNING    ║  ← 68% fill (black winning)
╚══════════════╝

Display: -1.8 (negative = you're losing)
```

---

### When Playing as BLACK:

**SAME POSITION as above, but display flips for your perspective!**

```
Position: Black is winning by +2.5 (same as white losing -1.8)
╔══════════════╗
║   BLACK      ║  ← 68% fill (YOU are winning)
║   WINNING    ║
║              ║
║──────────────║  ← 50% line (equal)
║              ║
║              ║
║   white      ║  ← 32% fill from bottom
╚══════════════╝

Display: +2.5 (positive = you're winning!)
```

```
Position: Black is losing by -1.8 (same as white winning +1.8)
╔══════════════╗
║   black      ║  ← 32% fill from top
║              ║
║              ║
║──────────────║  ← 50% line (equal)
║              ║
║   WHITE      ║
║   WINNING    ║  ← 68% fill (white winning)
╚══════════════╝

Display: -1.8 (negative = you're losing)
```

---

## Code Flow Example

Let's trace through a specific example:

### Scenario: After 1.e4, position is slightly better for white

**FEN:** `rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1`
- Note: `b` means it's BLACK's turn to move

**Stockfish Output:** `score cp +30`
- Stockfish says +30 centipawns (from BLACK's perspective, since black to move)
- This actually means white is 30 centipawns better!

### For a WHITE player:

1. **Convert to white's perspective:**
   ```javascript
   activeColor = 'b' (black to move)
   isBlackToMove = true
   rawCp = 30  // from Stockfish
   
   // Flip because black to move
   rawCp = -30  // Now from white's perspective (white is better by 0.3)
   ```

2. **Display calculation:**
   ```javascript
   viewFromBlack = false  // Player is white
   displayCp = rawCp = -30  // No additional flip needed
   
   pawns = -30 / 100 = -0.3
   displayScore = "-0.3"  // Negative = white is losing slightly
   
   // Wait, this is wrong! White should be WINNING
   ```

**CORRECTION:** The Stockfish output `+30` when black to move actually means BLACK thinks it's good for black by +30, but since we know white just played a good move (1.e4), this should actually be interpreted as white being better. The `+30` from black's perspective means white has a +30 advantage.

Let me reconsider: When it's black's turn and Stockfish says `+30`, it means "the position is good for the side to move (black) by +30". But 1.e4 is slightly better for white, so Stockfish would actually output something like `cp -30` (negative for black = white is better).

### Correct Scenario: After 1.e4

**Stockfish Output:** `score cp -30` (black to move, white is 0.3 pawns better)

### For a WHITE player:

1. **Convert to white's perspective:**
   ```javascript
   rawCp = -30  // from Stockfish (negative = bad for black = good for white)
   
   // Flip because black to move
   if (isBlackToMove) {
     rawCp = -(-30) = +30  // Now from white's perspective
   }
   ```

2. **Display calculation:**
   ```javascript
   viewFromBlack = false  // Player is white
   displayCp = rawCp = +30  // No additional flip
   
   pawns = 30 / 100 = 0.3
   displayScore = "+0.3"  // Positive = you're winning!
   fillPercent = 50 + (0.3 / 10) * 50 = 51.5%  // Slightly more fill at top
   ```

### For a BLACK player (SAME POSITION):

1. **Convert to white's perspective:**
   ```javascript
   rawCp = -30  // from Stockfish
   rawCp = +30  // After flip for black to move
   ```

2. **Display calculation:**
   ```javascript
   viewFromBlack = true  // Player is black
   displayCp = -rawCp = -30  // Flip for player perspective
   
   pawns = -30 / 100 = -0.3
   displayScore = "-0.3"  // Negative = you're losing
   
   // For bar fill:
   evalForFill = displayCp = -30
   fillPercent = 50 + (-0.3 / 10) * 50 = 48.5%  // Slightly less fill at top
   ```

---

## Summary

The key insight is:
- **Stockfish always evaluates from the current turn's perspective**
- **We normalize everything to white's perspective first** (rawCp)
- **Then we flip for display if player is black** (displayCp)
- **The bar fill always uses the player's perspective** (evalForFill)

This ensures:
- ✅ Positive score = YOU are winning (regardless of color)
- ✅ Negative score = YOU are losing (regardless of color)
- ✅ More bar fill at top = YOU are winning
- ✅ More bar fill at bottom = YOU are losing
