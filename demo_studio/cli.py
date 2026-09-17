import argparse
import json
import sys
from pathlib import Path

from . import SAMPLE


def main():
    parser = argparse.ArgumentParser(prog="demo-studio", description="With no command, opens the Demo Studio app in your browser.")
    commands = parser.add_subparsers(dest="command")
    speak = commands.add_parser("speak", help="voice a {key: text} JSON file (or stdin); prints each clip's file and length")
    speak.add_argument("lines", nargs="?")
    render = commands.add_parser("render", help="make the MP4 for a demo package folder; prints its path")
    render.add_argument("package")
    render.add_argument("--out")
    args = parser.parse_args()

    def log(text):
        print(text, file=sys.stderr, flush=True)

    sample = SAMPLE if SAMPLE.exists() else None
    if args.command and not sample:
        log("No voice recorded yet, so the built-in voice is used. Run `demo-studio` to record yours.")
    if args.command == "speak":
        from . import voice

        lines = json.loads(Path(args.lines).read_text(encoding="utf-8") if args.lines else sys.stdin.read())
        print(json.dumps(voice.speak(lines, sample, log)))
    elif args.command == "render":
        from . import render as renderer

        print(renderer.render(args.package, args.out, sample, log))
    else:
        from . import app

        app.serve()
