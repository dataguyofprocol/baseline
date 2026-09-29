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

echo "=== locations: one per task, shared across projects, never defaulted ==="
ADB=$(newdb agent)
ab() { BASELINE_DB="$ADB" $BIN "$@"; }
keyof() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).key))"; }
REPO="$WORK/agent-repo"; mkdir -p "$REPO"
PREPO="$WORK/project-repo"; mkdir -p "$PREPO"
checkon "$ADB" "agent config shows the terminal" "terminal: Terminal" agent config
checkon "$ADB" "location add" "agent-repo → $REPO" location add "$REPO"
checkon "$ADB" "location add links to a project" "proj-repo" location add "$PREPO" --name proj-repo -j "Agent Handoff"
checkon "$ADB" "one location can serve several projects" "Updated project" project update "Mobile Companion" --add-location proj-repo
checkon "$ADB" "location list shows its projects" "Agent Handoff, Mobile Companion" location list
checkon "$ADB" "project show lists locations" "locations: proj-repo ($PREPO)" project show "Agent Handoff"
checkon "$ADB" "adding a second location" "Updated project" project update "Mobile Companion" --add-location agent-repo
KD=$(ab issue create "project has one location" -t CORE -j "Agent Handoff" --json | keyof)
ab issue show "$KD" --json > "$WORK/l0.json"
check_json "a project's locations are suggestions, never defaults" "$WORK/l0.json" "d.location===null"
KI=$(ab issue create "explicit location" -t CORE -j "Agent Handoff" --location proj-repo --json | keyof)
ab issue show "$KI" --json > "$WORK/l1.json"
check_json "issue create --location sets it" "$WORK/l1.json" "d.location&&d.location.name==='proj-repo'"
KS=$(ab issue create "sub-task" -t CORE --parent "$KI" --json | keyof)
ab issue show "$KS" --json > "$WORK/l2.json"
check_json "sub-issue inherits its parent's location" "$WORK/l2.json" "d.location&&d.location.name==='proj-repo'"
KA=$(ab issue create "project has two locations" -t CORE -j "Mobile Companion" --json | keyof)
ab issue show "$KA" --json > "$WORK/l3.json"
check_json "no guess when the project has several" "$WORK/l3.json" "d.location===null"
if BASELINE_DB="$ADB" $BIN agent run >/dev/null 2>&1; then echo "FAIL  the background runner is gone"; FAILED_NAMES+=("agent run removed"); FAIL=$((FAIL+1)); else PASS=$((PASS+1)); fi
export BASELINE_SESSIONS_DIR="$WORK/sessions" BASELINE_OPEN_CMD="true"
checkon "$ADB" "issue open uses the issue's location" "in $PREPO" issue open "$KI"
if grep -q "cd '$PREPO'" "$WORK"/sessions/"$KI"-*.command && grep -q "BASELINE_AS=" "$WORK"/sessions/"$KI"-*.command; then PASS=$((PASS+1)); else echo "FAIL  launcher cds into the location with BASELINE_AS"; FAILED_NAMES+=("launcher script"); FAIL=$((FAIL+1)); fi
if [[ "$(stat -f %Lp "$WORK"/sessions/"$KI"-*.md 2>/dev/null | head -1 || stat -c %a "$WORK"/sessions/"$KI"-*.md | head -1)" == "600" ]]; then PASS=$((PASS+1)); else echo "FAIL  session brief is owner-only"; FAILED_NAMES+=("session brief perms"); FAIL=$((FAIL+1)); fi
if grep -q "issue show $KI --json" "$WORK"/sessions/"$KI"-*.md; then PASS=$((PASS+1)); else echo "FAIL  launcher prompt carries the brief"; FAILED_NAMES+=("launcher prompt"); FAIL=$((FAIL+1)); fi
checkon "$ADB" "issue open --location pins it" "pinned to agent-repo" issue open "$KA" --location agent-repo
checkon "$ADB" "sessions post as Claude Code" "Claude Code" user list
OUT=$(BASELINE_DB="$ADB" $BIN issue open "$(ab issue create "nowhere" -t CORE --location none --json | keyof)" 2>&1)
if [[ "$OUT" == *"has no location"* ]]; then PASS=$((PASS+1)); else echo "FAIL  issue open without a location explains itself"; FAILED_NAMES+=("issue open no location"); FAIL=$((FAIL+1)); fi
unset BASELINE_SESSIONS_DIR BASELINE_OPEN_CMD
checkon "$ADB" "location rename" "Renamed proj-repo" location rename proj-repo api
checkon "$ADB" "location remove" "Removed location api" location remove api
ab issue show "$KI" --json > "$WORK/l7.json"
check_json "removing a location clears it from issues" "$WORK/l7.json" "d.location===null"
checkon "$ADB" "handoff brief points at the baseline skill" "/baseline skill" issue handoff "$KI"

echo "=== export / import ==="
b agent config --terminal iTerm >/dev/null
b location add "$WORK" --name workdir >/dev/null
b export --out "$WORK/export.json"
check_json "export has issues" "$WORK/export.json" "d.issues.length>5&&d.teams.length>=2&&Array.isArray(d.projects)"
DB2=$(newdb 2)
checkon "$DB2" "import summary" "Imported:" import "$WORK/export.json"
checkon "$DB2" "import keeps the terminal choice" "terminal: iTerm" agent config
checkon "$DB2" "import keeps locations" "workdir" location list
node -e '
const f = process.argv[1]; const d = JSON.parse(require("fs").readFileSync(f, "utf8"));
delete d.locations; d.projects.forEach(p => delete p.locationIds); d.issues.forEach(i => delete i.locationId);
d.projects[0].directory = process.argv[2]; d.workspace.agentCwd = process.argv[3];
require("fs").writeFileSync(process.argv[4], JSON.stringify(d));
' "$WORK/export.json" "$WORK" "$WORK/runs" "$WORK/legacy.json"
DB5=$(newdb legacy)
checkon "$DB5" "legacy import" "Imported:" import "$WORK/legacy.json"
BASELINE_DB="$DB5" $BIN project list --json > "$WORK/p5.json"
check_json "a pre-locations export keeps its project directory as a location" "$WORK/p5.json" "d[0].locations.length===1&&d[0].locations[0].path==='$WORK'"
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

echo "=== migration: project directories become locations ==="
MDB=$(newdb migrate); MDIR="$WORK/old-project-dir"; mkdir -p "$MDIR"
node --input-type=module -e '
const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
const p = db.prepare("SELECT id FROM projects ORDER BY position LIMIT 1").get();
db.prepare("UPDATE projects SET directory = ? WHERE id = ?").run(process.argv[2], p.id);
db.prepare("UPDATE issues SET location_id = NULL").run();
db.prepare("DELETE FROM locations").run();
db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("agentCwd", process.argv[3]);
db.prepare("DELETE FROM meta WHERE key = ?").run("locationsMigrated");
' "$MDB" "$MDIR" "$WORK"
BASELINE_DB="$MDB" $BIN project list --json > "$WORK/m1.json"
check_json "old project directory → linked location" "$WORK/m1.json" "d[0].locations.length===1&&d[0].locations[0].path==='$MDIR'"
checkon "$MDB" "old default directory → a location pinned to nothing" "$(basename "$WORK")" location list
BASELINE_DB="$MDB" $BIN issue list -j "$(node -e "console.log(JSON.parse(require('fs').readFileSync('$WORK/m1.json','utf8'))[0].name)")" --json > "$WORK/m2.json"
check_json "that project's issues are pinned to it" "$WORK/m2.json" "d.length>0&&d.every(i=>i.location&&i.location.path==='$MDIR')"

echo "=== server accepts only this machine ==="
node --input-type=module -e '
const { createApp } = await import("./dist/server/index.js");
const { app } = createApp(process.argv[1]);
const r = async (path, init) => (await app.request(path, init)).status;
const bad = [];
if (await r("http://localhost/api/bootstrap") !== 200) bad.push("localhost GET");
if (await r("http://192.168.1.9:7770/api/bootstrap") !== 403) bad.push("LAN host GET");
if (await r("http://evil.example/api/bootstrap") !== 403) bad.push("rebinding host GET");
if (await r("http://localhost/api/workspace", { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" }) !== 403) bad.push("cross-site write");
if (await r("http://localhost/api/workspace", { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "http://localhost:5183" }, body: "{}" }) !== 200) bad.push("same-machine write");
if (await r("http://localhost/api/directories/pick", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" }) !== 403) bad.push("text/plain launch");
if (bad.length) { console.error("wrong status: " + bad.join(", ")); process.exit(1); }
' "$WORK/guard.db" > "$WORK/guard-out.txt" 2>&1
if [[ $? -eq 0 ]]; then PASS=$((PASS+1)); else echo "FAIL  host/origin guard — $(cat "$WORK/guard-out.txt" | tail -2)"; FAILED_NAMES+=("host/origin guard"); FAIL=$((FAIL+1)); fi

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
