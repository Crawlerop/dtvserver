import os
import sys
import time

if __name__ == "__main__":
    while True:
        os.system(" ".join(sys.argv[2:]))
        print(f"Restart process for {sys.argv[1]}", file=sys.stderr)
        time.sleep(2)
        if len(sys.stdin.buffer.read()) <= 0: break