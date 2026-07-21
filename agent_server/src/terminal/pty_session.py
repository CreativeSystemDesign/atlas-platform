"""Single PTY-backed bash session."""

from __future__ import annotations

import os
import re
import select
import shlex
import struct
import threading
import time
from collections.abc import Callable
from typing import TYPE_CHECKING

try:
    import fcntl
except ModuleNotFoundError:  # Windows local development: PTY routes are unavailable.
    fcntl = None

if TYPE_CHECKING:
    pass

EOT_MARKER = "__ATLAS_EOT__"

# Server-injected harness only (see run_agent_command). Matched against one logical line
# (bytes between \\n delimiters), with CR stripped — never real command stdout/stderr.
_RE_DISPLAY_DROP_EOT = re.compile(rb"^[\t ]*__ATLAS_EOT__:\d+[\t ]*$")
_RE_DISPLAY_DROP_EOT_SUB = re.compile(rb"__ATLAS_EOT__:\d+")
_RE_DISPLAY_DROP_EXIT = re.compile(rb"^[\t ]*(?:\[exit \d+\])[\t ]*$")
_RE_DISPLAY_DROP_STTY = re.compile(
    rb"(?:^|.*[$#<][ \t]*)s?tty -?echo 2>/dev/null \|\| true[\t ]*$"
)
_RE_DISPLAY_DROP_HARNESS_PRINTF = re.compile(
    rb"(?:^|[$][ \t])printf '\s*\\n(?:\\033\[90m\[exit %s\]\\033\[0m|__ATLAS_EOT__:%s)\\n'.*$"
)
_RE_ANSI_CSI = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]")
_RE_ANSI_OSC = re.compile(rb"\x1b\].*?(?:\x07|\x1b\\)")
_RE_NONVISUAL_CSI = re.compile(rb"\x1b\[\?2004[hl]")
_RE_PROMPT_ONLY = re.compile(rb"^(?:atlas|[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+):?.*[$#][ \t]*$")

# Injected once after bash starts: colored prompt, ls/grep colors, title bar (TERM=xterm-256color).
# PAGER/MANPAGER/GIT_PAGER=cat avoids interactive less/man in non-TUI agent shell sessions.
# Wrap in stty -echo/echo so the injected setup text is not echoed back to the PTY master
# (same idea as run_agent_command): humans/agents see a clean buffer, not raw exports.
_BASH_INIT = rb"""stty -echo 2>/dev/null || true
export PS1='\[\e[32;1m\]atlas\[\e[0m\] \[\e[34;1m\]\w\[\e[0m\] \[\e[33;1m\]\$\[\e[0m\] '
export PROMPT_DIRTRIM=4
export PAGER=cat GIT_PAGER=cat MANPAGER=cat LESS=FRX
export HISTFILE="${HOME}/.atlas_bash_history"
export HISTSIZE=10000 HISTFILESIZE=20000
shopt -s histappend 2>/dev/null || true
alias ls='ls --color=auto' 2>/dev/null || true
alias ll='ls -la --color=auto' 2>/dev/null || true
alias grep='grep --color=auto' 2>/dev/null || true
alias ip='ip -color=auto' 2>/dev/null || true
export GCC_COLORS='error=01;31:warning=01;35:note=01;36:caret=01;32:locus=01'
printf '\033]0;Atlas shell\007\033[36mAtlas\033[90m | \033[0mxterm-256color\033[0m\r\n'
stty echo 2>/dev/null || true
"""


def _set_nonblocking(fd: int) -> None:
    if fcntl is None:
        raise RuntimeError("PTY terminal sessions require POSIX fcntl support")
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)


def _ioctl_resize(fd: int, rows: int, cols: int) -> None:
    if fcntl is None:
        return
    try:
        import termios

        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except OSError:
        pass


class PtySession:
    """One bash process with a PTY master for I/O."""

    def __init__(
        self,
        session_id: str,
        kind: str,
        initial_cwd: str,
        on_tty_output: Callable[[bytes], None] | None = None,
    ) -> None:
        self.session_id = session_id
        self.kind = kind
        self.initial_cwd = initial_cwd
        self._on_tty_output = on_tty_output
        self.master_fd: int | None = None
        self.pid: int | None = None
        self._shell_lock = threading.Lock()
        self._scrollback = bytearray()
        self._scrollback_max = 256 * 1024
        # Incomplete line for display filtering (PTY reads can split anywhere).
        self._display_line_buf: bytes = b""

    def spawn(self) -> None:
        if fcntl is None or not hasattr(os, "fork") or not hasattr(os, "openpty"):
            raise RuntimeError("PTY terminal sessions are unavailable on this platform")
        master, slave = os.openpty()
        self.master_fd = master
        _set_nonblocking(master)

        pid = os.fork()
        if pid == 0:
            os.close(master)
            os.setsid()
            os.dup2(slave, 0)
            os.dup2(slave, 1)
            os.dup2(slave, 2)
            if slave > 2:
                os.close(slave)
            try:
                os.chdir(self.initial_cwd)
            except OSError:
                pass
            env = os.environ.copy()
            env.setdefault("TERM", "xterm-256color")
            env.setdefault("COLORTERM", "truecolor")
            env.setdefault("CLICOLOR", "1")
            os.execve("/bin/bash", ["bash"], env)

        os.close(slave)
        self.pid = pid
        time.sleep(0.2)
        self._inject_bootstrap()
        self._discard_bootstrap_output()

    def _inject_bootstrap(self) -> None:
        """One-time bash setup: prompt, aliases, colors (robust terminal UX)."""
        if self.master_fd is None:
            return
        try:
            os.write(self.master_fd, _BASH_INIT)
        except OSError:
            pass
        time.sleep(0.08)

    def close(self) -> None:
        # Flush partial line so prompts/output without a final newline are not lost.
        self._flush_display_line_buffer()
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None
        if self.pid is not None:
            try:
                os.kill(self.pid, 15)
            except OSError:
                pass
            self.pid = None

    def scrollback_bytes(self) -> bytes:
        return bytes(self._scrollback)

    def _append_scrollback(self, data: bytes) -> None:
        self._scrollback.extend(data)
        if len(self._scrollback) > self._scrollback_max:
            del self._scrollback[: len(self._scrollback) - self._scrollback_max]

    @staticmethod
    def _sanitize_display_line(line_without_lf: bytes) -> bytes:
        """Remove non-visual terminal control noise while preserving colors."""
        line = line_without_lf.replace(b"\r", b"")
        line = _RE_ANSI_OSC.sub(b"", line)
        line = _RE_NONVISUAL_CSI.sub(b"", line)
        return line.replace(b"\x07", b"")

    @classmethod
    def _normalize_line_for_harness(cls, line_without_lf: bytes) -> bytes:
        """Plain-text normalization for harness matching and shell tool returns."""
        line = cls._sanitize_display_line(line_without_lf)
        return _RE_ANSI_CSI.sub(b"", line)

    def _should_drop_display_line(self, line_without_lf: bytes) -> bool:
        """True only for server-injected harness lines (never real command output)."""
        n = self._normalize_line_for_harness(line_without_lf)
        if not n:
            return False
        if _RE_DISPLAY_DROP_EOT.match(n):
            return True
        # Split or noisy harness lines: drop if EOT marker appears as injected trailer.
        if EOT_MARKER.encode() in n and _RE_DISPLAY_DROP_EOT_SUB.search(n):
            return True
        if _RE_DISPLAY_DROP_EXIT.match(n):
            return True
        if _RE_DISPLAY_DROP_STTY.search(n):
            return True
        if _RE_DISPLAY_DROP_HARNESS_PRINTF.search(n):
            return True
        return False

    def _filter_display_chunk(self, chunk: bytes) -> bytes:
        """Remove harness lines from the human-facing stream; parse buffer stays raw elsewhere."""
        if not chunk:
            return b""
        self._display_line_buf += chunk
        out: list[bytes] = []
        while True:
            idx = self._display_line_buf.find(b"\n")
            if idx < 0:
                break
            line = self._display_line_buf[:idx]
            had_crlf = line.endswith(b"\r")
            self._display_line_buf = self._display_line_buf[idx + 1 :]
            display_line = self._sanitize_display_line(line)
            normalized = self._normalize_line_for_harness(line)
            if not self._should_drop_display_line(line) and not _RE_PROMPT_ONLY.match(
                normalized
            ):
                out.append(display_line + (b"\r\n" if had_crlf else b"\n"))
        return b"".join(out)

    def _flush_display_line_buffer(self) -> None:
        """Emit trailing bytes that never received a newline (e.g. session end)."""
        if not self._display_line_buf:
            return
        tail = self._display_line_buf
        self._display_line_buf = b""
        display_tail = self._sanitize_display_line(tail)
        normalized = self._normalize_line_for_harness(tail)
        if self._should_drop_display_line(tail) or _RE_PROMPT_ONLY.match(normalized):
            return
        self._append_scrollback(display_tail)
        if self._on_tty_output:
            self._on_tty_output(display_tail)

    def _emit(self, chunk: bytes) -> None:
        display = self._filter_display_chunk(chunk)
        if not display:
            return
        self._append_scrollback(display)
        if self._on_tty_output:
            self._on_tty_output(display)

    def write_bytes(self, data: bytes) -> None:
        if self.master_fd is None:
            return
        os.write(self.master_fd, data)

    def _discard_bootstrap_output(self, timeout_sec: float = 0.35) -> None:
        """Drain shell/bootstrap noise so fresh sessions start with a clean transcript."""
        self._drain_pending_pty_output(timeout_sec)
        self._scrollback.clear()

    def _drain_pending_pty_output(self, timeout_sec: float = 0.12) -> None:
        """Discard server-only prompt/setup bytes before the next visible transcript line."""
        if self.master_fd is None:
            return
        fd = self.master_fd
        deadline = time.monotonic() + timeout_sec
        while time.monotonic() < deadline:
            remaining = max(0.0, deadline - time.monotonic())
            r, _, _ = select.select([fd], [], [], min(0.05, remaining))
            if fd not in r:
                continue
            try:
                chunk = os.read(fd, 65536)
            except BlockingIOError:
                continue
            if not chunk:
                break
        self._display_line_buf = b""

    def _drain_command_trailer(self, timeout_sec: float = 0.12) -> None:
        """Discard post-marker prompts without touching already-emitted command output."""
        if self.master_fd is None:
            return
        fd = self.master_fd
        deadline = time.monotonic() + timeout_sec
        while time.monotonic() < deadline:
            remaining = max(0.0, deadline - time.monotonic())
            r, _, _ = select.select([fd], [], [], min(0.03, remaining))
            if fd not in r:
                continue
            try:
                chunk = os.read(fd, 65536)
            except BlockingIOError:
                continue
            if not chunk:
                break
        self._display_line_buf = b""

    def run_agent_command(
        self,
        command: str,
        working_directory: str,
        timeout_sec: float = 60.0,
    ) -> str:
        if self.master_fd is None:
            return "Error: terminal not initialized"
        wd = working_directory.strip() or self.initial_cwd
        inner = command.rstrip()
        if not inner:
            return "(no command)"
        # Newlines separate the command line from printf trailers (avoid one endless PTY line).
        # Dim [exit N] + EOT: raw parse sees them; display path strips them for humans.
        # Agent terminals are browser read-only, so input echo stays off after the
        # preamble; restoring it inside the buffered script can echo harness lines.
        script_body = (
            f"cd {shlex.quote(wd)} && {inner}; ec=$?;\n"
            "printf '\\n\\033[90m[exit %s]\\033[0m\\n' \"$ec\";\n"
            f"printf '\\n{EOT_MARKER}:%s\\n' \"$ec\"\n"
        )
        preamble = "stty -echo 2>/dev/null || true\n".encode("utf-8", errors="replace")
        body = script_body.encode("utf-8", errors="replace")

        with self._shell_lock:
            self.write_bytes(preamble)
            self._drain_pending_pty_output(0.16)
            self._emit(self._render_command_line(inner, wd))
            self.write_bytes(body)
            return self._read_until_eot(timeout_sec)

    def _read_until_eot(self, timeout_sec: float) -> str:
        assert self.master_fd is not None
        fd = self.master_fd
        buf = b""
        deadline = time.monotonic() + timeout_sec
        tail_exit = re.compile(rb"(?:\r\n|\n)\s*\033\[90m\[exit \d+\]\033\[0m\s*$")
        marker_line = re.compile(rb"__ATLAS_EOT__:\d+\r?\n")

        while time.monotonic() < deadline:
            remaining = max(0.0, deadline - time.monotonic())
            r, _, _ = select.select([fd], [], [], min(0.25, remaining))
            if fd in r:
                try:
                    chunk = os.read(fd, 65536)
                except BlockingIOError:
                    continue
                if not chunk:
                    break
                buf += chunk
                self._emit(chunk)
                m = marker_line.search(buf)
                if m:
                    out = buf[: m.start()]
                    out = tail_exit.sub(b"", out)
                    result = self._clean_captured_output(out)
                    self._drain_command_trailer()
                    return result

        tail = self._clean_captured_output(buf)
        return f"{tail}\n[timeout after {timeout_sec}s]"

    def _render_command_line(self, command: str, working_directory: str) -> bytes:
        wd = working_directory or self.initial_cwd
        home = os.path.expanduser("~")
        if wd == home:
            wd_display = "~"
        elif wd.startswith(f"{home}/"):
            wd_display = f"~{wd[len(home):]}"
        else:
            wd_display = wd
        prompt = (
            "\x1b[32;1matlas\x1b[0m "
            f"\x1b[34;1m{wd_display}\x1b[0m "
            "\x1b[33;1m$\x1b[0m "
            f"{command}\r\n"
        )
        return prompt.encode("utf-8", errors="replace")

    def _clean_captured_output(self, raw: bytes) -> str:
        cleaned_lines: list[bytes] = []
        for line in raw.replace(b"\r", b"").split(b"\n"):
            normalized = self._normalize_line_for_harness(line)
            if not normalized:
                cleaned_lines.append(b"")
                continue
            if self._should_drop_display_line(line):
                continue
            if _RE_PROMPT_ONLY.match(normalized):
                continue
            cleaned_lines.append(normalized)
        return b"\n".join(cleaned_lines).decode("utf-8", errors="replace").strip()

    def pump_user_forever(self, stop_event: threading.Event) -> None:
        if self.master_fd is None:
            return
        fd = self.master_fd
        while not stop_event.is_set():
            r, _, _ = select.select([fd], [], [], 0.3)
            if fd in r:
                try:
                    chunk = os.read(fd, 65536)
                except BlockingIOError:
                    continue
                if not chunk:
                    break
                self._emit(chunk)

    def resize(self, rows: int, cols: int) -> None:
        if self.master_fd is None:
            return
        _ioctl_resize(self.master_fd, max(1, rows), max(1, cols))
