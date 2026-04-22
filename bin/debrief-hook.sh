#!/usr/bin/env bash
# Wrapper for Claude Code SessionEnd hook.
# Claude Code kills hook processes on exit, so we capture stdin
# synchronously then hand off to a detached process for the
# slow git work (pull/commit/push over SSH).
INPUT=$(cat)
echo "$INPUT" | setsid debrief collect --stdin &
