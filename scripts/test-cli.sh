#!/usr/bin/env bash
# End-to-end test suite for the baseline CLI.
# Runs every project/task command against throwaway scratch databases — never
# touches the live workspace at ~/.baseline/baseline.db.
#
#   scripts/test-cli.sh            # build + test via node dist
#   scripts/test-cli.sh --no-build # skip the tsc build step
set -o pipefail
cd "$(dirname "$0")/.."

BIN=${BIN:-"node bin/baseline.js"}
if [[ "${1:-}" != "--no-build" ]]; then
  echo "building…"
  npx tsc -p tsconfig.node.json || { echo "build failed"; exit 1; }
fi

WORK=$(mktemp -d /tmp/baseline-cli-test.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
DB="$WORK/demo.db"

PASS=0; FAIL=0; FAILED_NAMES=()

export BASELINE_DB="$DB"                          # exercised env-var path
b() { $BIN "$@"; }                                # run against scratch DB
newdb() { BASELINE_DB="$WORK/db$1.db" $BIN team list >/dev/null 2>&1; echo "$WORK/db$1.db"; }

check() { # check <name> <expected-substring> <cli-args…>
  local name="$1" expect="$2"; shift 2
  local out rc
  out=$(b "$@" 2>/dev/null); rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "FAIL  $name (exit $rc)"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1)); return 1
  fi
  if [[ "$out" == *"$expect"* ]]; then
    PASS=$((PASS+1))
  else
    echo "FAIL  $name — output missing \"$expect\""; echo "      got: $(echo "$out" | head -3 | tr '\n' '|')"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1))
  fi
}

checkon() { # checkon <db> <name> <expected-substring> <cli-args…>
  local db="$1" name="$2" expect="$3"; shift 3
  local out rc
  out=$(BASELINE_DB="$db" $BIN "$@" 2>/dev/null); rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "FAIL  $name (exit $rc)"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1)); return 1
  fi
  if [[ "$out" == *"$expect"* ]]; then
    PASS=$((PASS+1))
  else
    echo "FAIL  $name — output missing \"$expect\""; echo "      got: $(echo "$out" | head -3 | tr '\n' '|')"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1))
  fi
}

check_absent() { # check_absent <name> <unwanted-substring> <args…>
  local name="$1" unwanted="$2"; shift 2
  local out rc
  out=$(b "$@" 2>/dev/null); rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "FAIL  $name (exit $rc)"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1)); return 1
  fi
  if [[ "$out" == *"$unwanted"* ]]; then
    echo "FAIL  $name — output should not contain \"$unwanted\""; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1))
  else
    PASS=$((PASS+1))
  fi
}

check_rc() { # check_rc <name> <expected-exit-code> <cli-args…>
  local name="$1" want="$2"; shift 2
  b "$@" >/dev/null 2>&1; local rc=$?
  if [[ $rc -eq $want ]]; then PASS=$((PASS+1)); else echo "FAIL  $name — exit $rc, expected $want"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1)); fi
}

jsonq() { # jsonq <file|-> <node-expr using d>
  node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('$1','utf8'));($2)?process.exit(0):process.exit(1)" 2>/dev/null
}

check_json() { # check_json <name> <json-file> <node-expr using d>
  local name="$1" file="$2" expr="$3"
  if jsonq "$file" "$expr"; then PASS=$((PASS+1)); else echo "FAIL  $name — json assertion: $expr"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1)); fi
}

echo "=== discovery: team / user / label list ==="
check  "team list shows CORE"        "CORE"          team list
check  "team list shows AGO"         "AGO"           team list
check  "team list shows states"      "In Progress(started)" team list
check  "user list shows Parth"       "Parth Batra"   user list
check  "user list shows Ada"         "Ada Osei"      user list
check  "label list shows Bug"        "Bug"           label list
check_absent "label list -t AGO hides Performance" "Performance" label list -t AGO

echo "=== issue create ==="
KEY=$(b issue create "CLI smoke test" -t CORE -s "In Progress" -p high -a Ada -l Bug -j "Agent Handoff" -d "body text here" --estimate 3 --due 2026-09-15 --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).key))")
[[ "$KEY" =~ ^CORE-[0-9]+$ ]] && { PASS=$((PASS+1)); } || { echo "FAIL  create --json returns key (got: $KEY)"; FAIL=$((FAIL+1)); }
J="$WORK/issue.json"
b issue show "$KEY" --json > "$J"
check_json "created issue fields" "$J" "d.title==='CLI smoke test'&&d.state==='In Progress'&&d.priority==='High'&&d.assignee==='Ada Osei'&&d.project==='Agent Handoff'&&d.labels.includes('Bug')&&d.estimate===3&&d.dueDate&&d.dueDate.startsWith('2026-09-15')"
check  "create prints bare key" "CORE-" issue create 'plain create' -t CORE
KEY2=$(b issue list -q "plain create" --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s)[0].key))")

echo "=== sub-issues ==="
CHILD=$(b issue create "child task" -t CORE --parent "$KEY" --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).key))")
check  "parent show lists sub-issues" "$CHILD" issue show "$KEY"
J="$WORK/child.json"; b issue show "$CHILD" --json > "$J"
check_json "child parent link" "$J" "d.parentId==='$KEY'"

echo "=== issue list filters ==="
check  "list by team+state"   "CLI smoke test"  issue list -t CORE -s "In Progress"
check  "list by project"      "CLI smoke test"  issue list -j "Agent Handoff"
check  "list by priority"     "CLI smoke test"  issue list -p high -t CORE
check_absent "list priority low excludes" "CLI smoke test" issue list -p low -t CORE
check  "list by label"        "CLI smoke test"  issue list -t CORE -L Bug
check  "list by query"        "CLI smoke test"  issue list -q smoke
check  "list by assignee"     "CLI smoke test"  issue list -a Ada
check_absent "list -a me excludes Ada's" "CLI smoke test" issue list -a me -q smoke
check  "list --json parses"   '"key"'           issue list --json
b issue list -q "CLI smoke test" --json > "$WORK/arr.json"
check_json "list json entry"  "$WORK/arr.json" "Array.isArray(d)&&d.length===1&&d[0].key==='$KEY'"

echo "=== issue update ==="
check  "update state"         "Updated"         issue update "$KEY" -s Done
J="$WORK/u1.json"; b issue show "$KEY" --json > "$J"
check_json "state now Done + completedAt" "$J" "d.state==='Done'&&!!d.completedAt"
check  "update priority/assignee/title/desc" "Updated" issue update "$KEY" -p urgent -a Jun --title "renamed issue" -d "new desc"
b issue show "$KEY" --json > "$J"
check_json "renamed + urgent + Jun" "$J" "d.title==='renamed issue'&&d.priority==='Urgent'&&d.assignee==='Jun Watanabe'"
check  "add label"            "Updated"         issue update "$KEY" --add-labels Performance
check  "label added"          "Performance"     issue show "$KEY"
check  "remove label"         "Updated"         issue update "$KEY" --remove-labels Bug
check_absent "Bug removed"    "Bug"             issue show "$KEY"
check  "replace labels"       "Updated"         issue update "$KEY" --labels "Improvement,Performance"
b issue show "$KEY" --json > "$J"
check_json "label set replaced" "$J" "d.labels.length===2&&d.labels.includes('Improvement')&&d.labels.includes('Performance')"
check  "clear estimate/due"   "Updated"         issue update "$KEY" --estimate none --due none
b issue show "$KEY" --json > "$J"
check_json "estimate/due cleared" "$J" "d.estimate===null&&d.dueDate===null"
check  "clear project"        "Updated"         issue update "$KEY" --project none
b issue show "$KEY" --json > "$J"
check_json "project cleared"  "$J" "d.project===null"
check  "clear parent"         "Updated"         issue update "$CHILD" --parent none
b issue show "$CHILD" --json > "$J"
check_json "parent detached"  "$J" "d.parentId===null"

echo "=== relations ==="
A=$(b issue create "rel A" -t CORE --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).key))")
B=$(b issue create "rel B" -t CORE --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).key))")
C=$(b issue create "rel C" -t CORE --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).key))")
check  "relate blocks"        "blocks"          issue relate "$A" "$B" --type blocks
check  "A shows blocks B"     "blocks $B"       issue show "$A"
check  "B shows blocked_by A" "blocked_by $A"   issue show "$B"
check  "relate default type"  "related"         issue relate "$A" "$C"
b issue show "$A" --json > "$J"
check_json "relations json"   "$J" "d.relations.some(r=>r.type==='blocks'&&r.issue==='$B')&&d.relations.some(r=>r.type==='related'&&r.issue==='$C')"
check  "unrelate"             "Removed"         issue unrelate "$A" "$B"
check_absent "blocks gone from A" "blocks $B"   issue show "$A"
check_absent "inverse gone from B" "blocked_by $A" issue show "$B"
check_rc "relate to self rejected" 1 issue relate "$A" "$A"
check_rc "invalid relation type rejected" 1 issue relate "$A" "$B" --type enemies

echo "=== comments ==="
check  "add comment"          "Commented"       issue comment "$A" "hello world"
CMID=$(b issue comments "$A" | grep -oE 'c_[A-Za-z0-9]+' | head -1)
[[ -n "$CMID" ]] && PASS=$((PASS+1)) || { echo "FAIL  comment id listed"; FAIL=$((FAIL+1)); }
check  "comments list body"   "hello world"     issue comments "$A"
check  "comment edit"         "Updated"         comment edit "$CMID" "edited body"
check  "edited body visible"  "edited body"     issue comments "$A"
check  "comment delete"       "Deleted"         comment delete "$CMID"
check_absent "comment gone"   "hello world"     issue comments "$A"

echo "=== archive / restore / delete ==="
b issue create "to archive" -t CORE >/dev/null
ARC=$(b issue list -q "to archive" --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s)[0].key))")
check  "archive"              "Archived"        issue archive "$ARC"
check_absent "archived hidden from list" "$ARC" issue list -t CORE
check  "archived listable"    "$ARC"            issue list --archived -t CORE
check  "unarchive"            "Unarchived"      issue unarchive "$ARC"
check  "back in list"         "$ARC"            issue list -t CORE
b issue create "to delete" -t CORE >/dev/null
DEL=$(b issue list -q "to delete" --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s)[0].key))")
check  "soft delete"          "Deleted"         issue delete "$DEL"
check_absent "deleted hidden" "$DEL"            issue list -t CORE
check  "restore"              "Restored"        issue restore "$DEL"
check  "restored visible"     "$DEL"            issue list -t CORE
check  "purge"                "purged"          issue delete "$DEL" --purge
check_rc "purged issue unknown" 1 issue show "$DEL"

echo "=== bulk ==="
BK=()
for n in bulk1 bulk2 bulk3; do
  b issue create "$n" -t CORE >/dev/null
  BK+=($(b issue list -q "$n" --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s)[0].key))"))
done
check  "bulk update"          "Updated 3"       issue bulk "${BK[@]}" -s Done -p low -a Ada --add-labels Bug
b issue list -q bulk1 --json > "$J"
check_json "bulk applied"     "$J" "d[0].state==='Done'&&d[0].priority==='Low'&&d[0].assignee==='Ada Osei'&&d[0].labels.includes('Bug')"
check  "bulk delete"          "Updated 2"       issue bulk "${BK[0]}" "${BK[1]}" --delete
check_absent "bulk-deleted hidden" "${BK[0]}"   issue list -t CORE
b issue restore "${BK[0]}" >/dev/null

echo "=== move ==="
M1=$(b issue create "move me" -t CORE --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).key))")
M2=$(b issue create "neighbor" -t CORE --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).key))")
check  "move before"          "Moved"           issue move "$M1" --before "$M2"
b issue list -q "move me" --json > "$J"
check_rc "move requires exactly one anchor" 1 issue move "$M1" --before "$M2" --after "$M1"

echo "=== search ==="
check  "search finds issue"   "renamed issue"   search "renamed"
check  "search finds project" "project: Agent Handoff" search "Agent Handoff"

echo "=== projects ==="
check  "project create"       "Created project" project create "CLI Test Project" -d "test project" -l Jun -t CORE --start 2026-08-01 --target 2026-10-01 -p high
check  "project list shows"   "CLI Test Project" project list
b project list --json > "$WORK/p.json"
check_json "project list json" "$WORK/p.json" "d.some(p=>p.name==='CLI Test Project'&&p.lead==='Jun Watanabe'&&p.team==='CORE'&&p.priority==='High')"
check  "project show"         "test project"    project show "CLI Test"
check  "project show lead"    "lead: Jun Watanabe" project show "CLI Test"
check  "project update"       "Updated project" project update "CLI Test" --status started --health atRisk
check  "project rename"       "Updated project" project update "CLI Test" --new-name "CLI Test Renamed"
check  "renamed visible"      "CLI Test Renamed" project list
check  "project note"         "Posted update"   project note "CLI Test Renamed" "weekly update body" --health onTrack
check  "note visible"         "weekly update body" project show "CLI Test Renamed"
check  "note health applied"  "health: onTrack" project show "CLI Test Renamed"
check  "project clear dates"  "Updated project" project update "CLI Test Renamed" --start none --target none -p low
b project show "CLI Test Renamed" --json > "$WORK/p2.json"
check_json "dates cleared + priority" "$WORK/p2.json" "d.startDate===null&&d.targetDate===null&&d.priority==='Low'&&d.status==='started'&&d.health==='onTrack'"

echo "=== project progress + issues ==="
PI=()
for n in prog1 prog2 prog3 prog4; do
  b issue create "$n" -t CORE -j "CLI Test Renamed" >/dev/null
  PI+=($(b issue list -q "$n" --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s)[0].key))"))
done
b issue update "${PI[0]}" -s Done >/dev/null
b issue update "${PI[1]}" -s Canceled >/dev/null
b project show "CLI Test Renamed" --json > "$J"
check_json "progress 50%"     "$J" "d.progress.total===4&&d.progress.done===2&&d.progress.percent===50"
check_json "project issues listed" "$J" "d.issues.length===4"
check  "issue list by project" "prog1"          issue list -j "CLI Test Renamed"

echo "=== project milestones ==="
check  "milestone add"        "Created milestone" project milestone-add "CLI Test Renamed" "Beta cut" --target 2026-09-30
check  "milestone in show"    "Beta cut"          project show "CLI Test Renamed"
check  "milestone update"     "Updated milestone" project milestone-update "CLI Test Renamed" "Beta cut" --status inProgress --rename "Beta 1"
check  "renamed in show"      "Beta 1"            project show "CLI Test Renamed"
b project show "CLI Test Renamed" --json > "$J"
check_json "milestone json fields" "$J" "d.milestones.some(m=>m.name==='Beta 1'&&m.status==='inProgress'&&m.targetDate==='2026-09-30')"
check  "milestone delete"     "Deleted milestone" project milestone-delete "CLI Test Renamed" "Beta 1"
check_rc "unknown milestone rejected" 1          project milestone-update "CLI Test Renamed" "Nope" --status done

echo "=== project delete detaches issues ==="
check  "project delete"       "Deleted project" project delete "CLI Test Renamed"
check_absent "project gone"   "CLI Test Renamed" project list
b issue show "${PI[0]}" --json > "$J"
check_json "issue kept, detached" "$J" "d.project===null&&d.title==='prog1'"

echo "=== milestones on a seeded project ==="
b project show "Agent Handoff" > "$WORK/ah.txt" 2>&1 || true
check  "seeded project shows" "Agent Handoff"   project show "Agent Handoff"
check  "progress line"        "progress:"       project show "Agent Handoff"

echo "=== label CRUD ==="
check  "label create"         "Created label"   label create "Flaky" -t CORE -c "#ff0000" -d "test flake"
check  "label visible"        "Flaky"           label list -t CORE
check  "label update"         "Updated label"   label update "Flaky" -t CORE -n "Flaky Test"
check  "renamed visible"      "Flaky Test"      label list -t CORE
check  "apply renamed label"  "Updated"         issue update "$A" --add-labels "Flaky Test"
check  "label delete"         "Deleted label"   label delete "Flaky Test" -t CORE
check_absent "label gone"     "Flaky Test"      label list -t CORE
b issue show "$A" --json > "$J"
check_json "label detached from issue" "$J" "!d.labels.includes('Flaky Test')"

echo "=== agent identities ==="
check  "seeded agent user"     "Agent"           user list
check  "user add agent"        "Created agent"   user add "Codex" --agent
check  "user add human"        "Created user"    user add "Ada Clone"
if b user list 2>/dev/null | grep -q '^Codex.*agent'; then PASS=$((PASS+1)); else echo "FAIL  agent kind marker on user list"; FAIL=$((FAIL+1)); fi
if b user list 2>/dev/null | grep -q '^Ada Clone' && ! b user list 2>/dev/null | grep -q '^Ada Clone.*agent'; then PASS=$((PASS+1)); else echo "FAIL  human user not marked agent"; FAIL=$((FAIL+1)); fi

echo "=== issue handoff ==="
BRANCH="$(echo "$KEY" | tr '[:upper:]' '[:lower:]')-renamed-issue"
check  "handoff includes title"  "renamed issue"  issue handoff "$KEY"
check  "handoff includes branch" "$BRANCH"        issue handoff "$KEY"
check  "handoff suggests report-back" "state to Done" issue handoff "$KEY"
b issue handoff "$KEY" --json > "$WORK/h.json"
check_json "handoff json shape" "$WORK/h.json" "d.key==='$KEY'&&d.title==='renamed issue'&&d.branchName==='$BRANCH'&&d.prompt.includes('renamed issue')&&d.url.includes('/#/issue/')"
check_rc "handoff unknown issue" 1 issue handoff "NOPE-99"
# --copy failure path: strip PATH so no clipboard helper exists (avoids clobbering the real clipboard)
NODE_BIN=$(command -v node)
if PATH="" "$NODE_BIN" bin/baseline.js issue handoff "$KEY" --copy >/dev/null 2>&1; then
  echo "FAIL  handoff --copy missing-clipboard error path"; FAIL=$((FAIL+1))
else
  PASS=$((PASS+1))
fi

echo "=== BASELINE_AS attribution ==="
BASELINE_AS=Agent b issue comment "$KEY" "attributed via env" >/dev/null
AGENT_ID=$(b user list --json 2>/dev/null | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{try{console.log(JSON.parse(s).find(u=>u.kind==='agent').id)}catch{}})")
if [[ -n "$AGENT_ID" ]]; then
  BASELINE_AS="$AGENT_ID" b issue comment "$KEY" "attributed via env id" >/dev/null
  check "BASELINE_AS accepts user id" "attributed via env id" issue comments "$KEY"
fi
BASELINE_AS=Agent b issue comment "$KEY" "flag wins" --as Ada >/dev/null
if b issue comments "$KEY" | grep -q "Ada Osei .*flag wins"; then PASS=$((PASS+1)); else echo "FAIL  --as overrides BASELINE_AS"; FAILED_NAMES+=("--as overrides BASELINE_AS"); FAIL=$((FAIL+1)); fi
if b issue comments "$KEY" | grep -q "Agent .*attributed via env$"; then PASS=$((PASS+1)); else echo "FAIL  BASELINE_AS name attribution"; FAILED_NAMES+=("BASELINE_AS name attribution"); FAIL=$((FAIL+1)); fi

echo "=== integrated agent (fake claude via BASELINE_AGENT_CMD) ==="
ADB=$(newdb agent)
REPO="$WORK/agent-repo"
mkdir -p "$REPO" && git -C "$REPO" init -q -b main && echo hi > "$REPO/README.md" \
  && git -C "$REPO" add . && git -C "$REPO" -c user.email=t@t -c user.name=t commit -qm init
export BASELINE_RUNS_DIR="$WORK/runs"
ab() { BASELINE_DB="$ADB" $BIN "$@"; }
akey() { ab issue create "$1" -t CORE -s Todo -a Agent --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).key))"; }
checkon "$ADB" "agent off by default" "runner: off" agent config
checkon "$ADB" "agent run is a no-op when off" "nothing to run" agent run
checkon "$ADB" "agent config on" "Claude Code" agent config --claude --cwd "$REPO"
K1=$(akey "agent task one"); K2=$(akey "agent task two")
FAKE_OK="git checkout -q -b agent-branch && echo x > new.txt && git add . && git -c user.email=t@t -c user.name=t commit -qm work && node $PWD/bin/baseline.js issue comment \$BASELINE_ISSUE 'progress from inside the run' >/dev/null && echo 'did the thing'"
BASELINE_AGENT_CMD="$FAKE_OK" checkon "$ADB" "agent run finishes first queued issue" "finished $K1" agent run
ab issue show "$K1" --json > "$WORK/a1.json"
check_json "agent run → Done + summary comment" "$WORK/a1.json" "d.state==='Done'&&d.comments.some(c=>c.author==='Agent'&&c.body.includes('did the thing')&&c.body.includes('agent-branch')&&c.body.includes('new.txt'))"
check_json "BASELINE_AS set inside the run" "$WORK/a1.json" "d.comments.some(c=>c.author==='Agent'&&c.body==='progress from inside the run')"
ab issue show "$K2" --json > "$WORK/a2.json"
check_json "second issue untouched (one at a time)" "$WORK/a2.json" "d.state==='Todo'&&d.assignee==='Agent'"
BASELINE_AGENT_CMD="echo boom >&2; exit 3" BASELINE_DB="$ADB" $BIN agent run >/dev/null 2>&1; RC=$?
if [[ $RC -eq 1 ]]; then PASS=$((PASS+1)); else echo "FAIL  failed agent run exits 1 (got $RC)"; FAILED_NAMES+=("failed agent run exit"); FAIL=$((FAIL+1)); fi
ab issue show "$K2" --json > "$WORK/a3.json"
check_json "failed run hands issue back to me" "$WORK/a3.json" "d.state==='Todo'&&d.assignee!=='Agent'&&d.comments.some(c=>c.author==='Agent'&&c.body.includes('Run failed')&&c.body.includes('boom'))"
checkon "$ADB" "queue empty after hand-back" "nothing to run" agent run
checkon "$ADB" "agent config off" "runner: off" agent config --off
unset BASELINE_RUNS_DIR

echo "=== export / import ==="
b export --out "$WORK/export.json"
check_json "export has issues" "$WORK/export.json" "d.issues.length>5&&d.teams.length>=2&&Array.isArray(d.projects)"
DB2=$(newdb 2)
checkon "$DB2" "import summary" "Imported:" import "$WORK/export.json"
BASELINE_DB="$DB2" $BIN issue list -q "renamed issue" --json > "$J"
check_json "imported issue round-trips" "$J" "d.length===1&&d[0].key==='$KEY'&&d[0].title==='renamed issue'"
BASELINE_DB="$DB2" $BIN project list --json > "$WORK/p3.json"
check_json "imported projects round-trip" "$WORK/p3.json" "d.some(p=>p.name==='Agent Handoff')"
if BASELINE_DB="$DB2" $BIN user list 2>/dev/null | grep -q '^Codex.*agent'; then PASS=$((PASS+1)); else echo "FAIL  agent kind survives export/import"; FAIL=$((FAIL+1)); fi

echo "=== seed ==="
DB3=$(newdb 3)
checkon "$DB3" "seed --reset" "Seeded:" seed --reset

echo "=== explicit --db flag path ==="
DB4="$WORK/db4.db"
check  "explicit --db flag"   "CORE"            team list --db "$DB4"
check_rc "explicit --db flag usable db" 0        issue list --db "$DB4" -t CORE

echo "=== error paths (exit codes + messages) ==="
check_rc "show unknown issue"        1 issue show "NOPE-99"
check_rc "unknown team on create"    1 issue create "x" -t NOPE
b issue create "err target" -t CORE >/dev/null
ERRKEY=$(b issue list -q "err target" --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s)[0].key))")
check_rc "unknown state on update"   1 issue update "$ERRKEY" -s Bogus
check_rc "unknown priority"          1 issue update "$ERRKEY" -p extreme
check_rc "unknown project show"      1 project show "NoSuch Project Anywhere"
check_rc "unknown label on create"   1 issue create "x" -t CORE -l NoSuchLabel
check_rc "unknown comment edit"      1 comment edit "c_bogus" "x"
check_rc "import missing file"       1 import "/nonexistent/file.json"
check_rc "unrelate nothing"          1 issue unrelate "$A" "$B"
check_rc "move both anchors"         1 issue move "$A" --before "$B" --after "$A"

echo "=== json purity (stderr not polluted into stdout) ==="
b issue list --json > "$WORK/purity.json" 2>/dev/null
check_json "issue list --json parses cleanly" "$WORK/purity.json" "Array.isArray(d)"

echo "=== store createProject status/memberIds (web API fields) ==="
node -e '
const { createApp } = require("./dist/server/index.js");
const { resolveDbPath } = require("./dist/core/db.js");
const { store } = createApp(process.argv[1]);
const p = store.createProject({ name: "Store Fields", status: "started", memberIds: ["u1", "u2"], priority: 2 });
if (p.status !== "started" || JSON.stringify(p.memberIds) !== JSON.stringify(["u1", "u2"])) {
  console.error("status/memberIds not persisted"); process.exit(1);
}
if (store.snapshot().projects.find(x => x.id === p.id)?.status !== "started") {
  console.error("status not in snapshot"); process.exit(1);
}
const d = store.createProject({ name: "Store Defaults" });
if (d.status !== "planned" || d.memberIds.length !== 0 || d.completedAt !== null) {
  console.error("defaults wrong"); process.exit(1);
}
' "$WORK/store-fields.db" > "$WORK/store-out.txt" 2>&1
if [[ $? -eq 0 ]]; then
  PASS=$((PASS+1))
else
  echo "FAIL  store createProject fields"; cat "$WORK/store-out.txt"; FAILED_NAMES+=("store createProject fields"); FAIL=$((FAIL+1))
fi

echo
echo "================================"
echo "PASS: $PASS  FAIL: $FAIL"
if [[ $FAIL -gt 0 ]]; then
  echo "failed: ${FAILED_NAMES[*]}"
  exit 1
fi
echo "ALL CLI TESTS PASSED"
