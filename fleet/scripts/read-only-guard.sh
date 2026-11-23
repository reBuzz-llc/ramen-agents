# Sourced first by every script that installs, starts, stops or updates something. The fleet folder on the main branch is a
# copy of the code for reading: nothing is installed, started or updated from it.
_read_only_dir=$(dirname "$0")
for _read_only_up in .. ../..; do
  if [ -f "$_read_only_dir/$_read_only_up/READ-ONLY-COPY.md" ]; then
    echo "This folder is the read-only copy of the code on the main branch: nothing is installed or run from it." >&2
    echo "Install from the fleet branch: git clone -b fleet -o starter https://github.com/reBuzz-llc/ramen-agents ~/bots" >&2
    exit 1
  fi
done
unset _read_only_dir _read_only_up
