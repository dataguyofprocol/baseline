#!/usr/bin/env bash
# End-to-end test suite for the baseline CLI.
# Runs every project/task command against throwaway scratch databases and never
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
    echo "FAIL  $name: output missing \"$expect\""; echo "      got: $(echo "$out" | head -3 | tr '\n' '|')"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1))
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
    echo "FAIL  $name: output missing \"$expect\""; echo "      got: $(echo "$out" | head -3 | tr '\n' '|')"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1))
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
    echo "FAIL  $name: output should not contain \"$unwanted\""; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1))
  else
    PASS=$((PASS+1))
  fi
}

check_rc() { # check_rc <name> <expected-exit-code> <cli-args…>
  local name="$1" want="$2"; shift 2
  b "$@" >/dev/null 2>&1; local rc=$?
  if [[ $rc -eq $want ]]; then PASS=$((PASS+1)); else echo "FAIL  $name: exit $rc, expected $want"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1)); fi
}

jsonq() { # jsonq <file|-> <node-expr using d>
  node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('$1','utf8'));($2)?process.exit(0):process.exit(1)" 2>/dev/null
}

check_json() { # check_json <name> <json-file> <node-expr using d>
  local name="$1" file="$2" expr="$3"
  if jsonq "$file" "$expr"; then PASS=$((PASS+1)); else echo "FAIL  $name: json assertion failed: $expr"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1)); fi
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
check  "user add agent"        "Created agent"   user add "Reviewer Bot" --agent
check  "user add human"        "Created user"    user add "Ada Clone"
if b user list 2>/dev/null | grep -q '^Reviewer Bot.*agent'; then PASS=$((PASS+1)); else echo "FAIL  agent kind marker on user list"; FAIL=$((FAIL+1)); fi
if b user list 2>/dev/null | grep -q '^Ada Clone' && ! b user list 2>/dev/null | grep -q '^Ada Clone.*agent'; then PASS=$((PASS+1)); else echo "FAIL  human user not marked agent"; FAIL=$((FAIL+1)); fi

echo "=== personal API keys ==="
check  "api-key create prints token" "bl_api_"     api-key create "CLI test" -s read -t CORE
check  "api-key list shows scopes"   "read · teams CORE" api-key list
check_rc "api-key bad scope"  1                    api-key create "bad" -s fly
check  "api-key revoke"              "Revoked CLI test" api-key revoke "CLI test"
check  "api-key list empty"          "No API keys"  api-key list

echo "=== issue handoff ==="
BRANCH="$(echo "$KEY" | tr '[:upper:]' '[:lower:]')-renamed-issue"
check  "handoff includes title"  "renamed issue"  issue handoff "$KEY"
check  "handoff includes branch" "$BRANCH"        issue handoff "$KEY"
check  "handoff suggests report-back" "baseline agent finish-issue $KEY" issue handoff "$KEY"
b issue handoff "$KEY" --json > "$WORK/h.json"
check_json "handoff json shape" "$WORK/h.json" "d.key==='$KEY'&&d.title==='renamed issue'&&(d.branchName==='$BRANCH'||d.branchName.endsWith('/$BRANCH'))&&d.prompt.includes('renamed issue')&&d.url.includes('/#/issue/')"
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
# an agent writes for this machine's user: "Agent via <you>"; a person's own write has no via
check "issue show: an agent's comment reads <agent> via <person>" "— Agent via " issue show "$KEY"
if b issue show "$KEY" | grep -q "^— Ada Osei (c_.*flag wins"; then PASS=$((PASS+1)); else echo "FAIL  issue show: a person's comment has no via"; FAILED_NAMES+=("person comment no via"); FAIL=$((FAIL+1)); fi
check "issue show --json: via on an agent's comment" '"via": "' issue show "$KEY" --json
VIAJSON=$(b issue show "$KEY" --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s);const c=d.comments.find(c=>c.body==='attributed via env');console.log(c.author+'|'+(c.viaUserId?'id':'none')+'|'+d.comments.find(c=>c.body==='flag wins').viaUserId)})")
if [[ "$VIAJSON" == "Agent|id|null" ]]; then PASS=$((PASS+1)); else echo "FAIL  issue show --json viaUserId (got $VIAJSON)"; FAILED_NAMES+=("json viaUserId"); FAIL=$((FAIL+1)); fi
# a command that still opens the database directly records the via too
VIAKEY=$(b issue create "agent archives this" -t CORE --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).key))")
BASELINE_AS=Agent b issue archive "$VIAKEY" >/dev/null
ARCHVIA=$(b issue show "$VIAKEY" --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const a=JSON.parse(s).activity.find(a=>a.type==='archived');console.log(a.user+' via '+a.via)})")
if [[ "$ARCHVIA" == Agent\ via\ ?* && "$ARCHVIA" != "Agent via null" ]]; then PASS=$((PASS+1)); else echo "FAIL  legacy command records the via (got $ARCHVIA)"; FAILED_NAMES+=("legacy via"); FAIL=$((FAIL+1)); fi
BASELINE_AS=Agent b project note "Agent Handoff" "agent note" >/dev/null
check "project note as an agent" "agent note" project show "Agent Handoff"
AGENTDEF=$(env -u BASELINE_AS $BIN agent post-progress "$KEY" --did "defaulted to Agent" --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).attributed_to))")
if [[ "$AGENTDEF" == Agent\ via\ ?* ]]; then PASS=$((PASS+1)); else echo "FAIL  agent commands write as Agent without BASELINE_AS (got $AGENTDEF)"; FAILED_NAMES+=("agent default actor"); FAIL=$((FAIL+1)); fi

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
if grep -q "baseline agent start-issue $KI" "$WORK"/sessions/"$KI"-*.md; then PASS=$((PASS+1)); else echo "FAIL  launcher prompt carries the brief"; FAILED_NAMES+=("launcher prompt"); FAIL=$((FAIL+1)); fi
checkon "$ADB" "issue open --location pins it" "pinned to agent-repo" issue open "$KA" --location agent-repo
checkon "$ADB" "sessions post as Agent" "Agent" user list
OUT=$(BASELINE_DB="$ADB" $BIN issue open "$(ab issue create "nowhere" -t CORE --location none --json | keyof)" 2>&1)
if [[ "$OUT" == *"has no location"* ]]; then PASS=$((PASS+1)); else echo "FAIL  issue open without a location explains itself"; FAILED_NAMES+=("issue open no location"); FAIL=$((FAIL+1)); fi
unset BASELINE_SESSIONS_DIR BASELINE_OPEN_CMD
checkon "$ADB" "location rename" "Renamed proj-repo" location rename proj-repo api
checkon "$ADB" "location remove" "Removed location api" location remove api
ab issue show "$KI" --json > "$WORK/l7.json"
check_json "removing a location clears it from issues" "$WORK/l7.json" "d.location===null"
checkon "$ADB" "handoff brief points at the baseline skill" "/baseline skill" issue handoff "$KI"

echo "=== export / import ==="
b agent config --terminal ghostty >/dev/null
b location add "$WORK" --name workdir >/dev/null
b export --out "$WORK/export.json"
check_json "export has issues" "$WORK/export.json" "d.issues.length>5&&d.teams.length>=2&&Array.isArray(d.projects)"
DB2=$(newdb 2)
checkon "$DB2" "import summary" "Imported:" import "$WORK/export.json"
checkon "$DB2" "import keeps the terminal choice" "terminal: Ghostty" agent config
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
if BASELINE_DB="$DB2" $BIN user list 2>/dev/null | grep -q '^Reviewer Bot.*agent'; then PASS=$((PASS+1)); else echo "FAIL  agent kind survives export/import"; FAIL=$((FAIL+1)); fi

echo "=== seed ==="
DB3=$(newdb 3)
checkon "$DB3" "seed --reset" "Seeded:" seed --reset

echo "=== initiatives: ids, priority, labels, lead team ==="
checkon "$DB3" "initiative list shows I- ids" "I-1 " initiative list
checkon "$DB3" "initiative update by I- id sets priority and labels" "Updated initiative I-3" initiative update I-3 --priority urgent --label Docs "Q1 bet"
BASELINE_DB="$DB3" $BIN initiative list --json > "$WORK/ini.json"
check_json "priority and labels stored" "$WORK/ini.json" "d.find(i=>i.key==='I-3').priority==='Urgent'&&['Docs','Q1 bet'].every(l=>d.find(i=>i.key==='I-3').labels.includes(l))"
checkon "$DB3" "remove a label" "Updated" initiative update "Developer love" --remove-label Docs --team CORE --updates weekly
BASELINE_DB="$DB3" $BIN initiative list --json > "$WORK/ini.json"
check_json "label removed, team and schedule set" "$WORK/ini.json" "(i=>!i.labels.includes('Docs')&&i.labels.includes('Q1 bet')&&i.team==='CORE'&&i.updateSchedule==='weekly'&&!!i.updateDueAt)(d.find(i=>i.key==='I-3'))"
checkon "$DB3" "create with priority, labels and team" "Created initiative I-4" initiative create "Self-serve" -p high --label Growth -t AGO
checkon "$DB3" "initiative label list" "Q1 bet" initiative label list
checkon "$DB3" "initiative label create" "Created initiative label" initiative label create Platform --color "#4ea7fc"
BASELINE_DB="$DB3" $BIN initiative list --json > "$WORK/ini.json"
check_json "seeded labels are reused, not duplicated" "$WORK/ini.json" "d.find(i=>i.key==='I-4').labels.join()==='Growth'&&d.find(i=>i.key==='I-4').priority==='High'"
BASELINE_DB="$DB3" $BIN initiative label list --json > "$WORK/il.json"
check_json "one Growth label" "$WORK/il.json" "d.filter(l=>l.name==='Growth').length===1&&d.find(l=>l.name==='Growth').initiatives===3"
check_rc "bad priority fails" 1 initiative update I-1 --priority huge --db "$DB3"
BASELINE_DB="$DB3" $BIN export --out "$WORK/ini-export.json"
DB6=$(newdb 6)
checkon "$DB6" "import with initiative fields" "Imported:" import "$WORK/ini-export.json"
BASELINE_DB="$DB6" $BIN initiative list --json > "$WORK/ini6.json"
check_json "initiative fields round-trip" "$WORK/ini6.json" "d.find(i=>i.key==='I-4').labels.join()==='Growth'&&d.find(i=>i.key==='I-3').team==='CORE'&&d.find(i=>i.key==='I-1').priority==='Urgent'"

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
if [[ $? -eq 0 ]]; then PASS=$((PASS+1)); else echo "FAIL  host/origin guard: $(cat "$WORK/guard-out.txt" | tail -2)"; FAILED_NAMES+=("host/origin guard"); FAIL=$((FAIL+1)); fi

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

nodecheck() { # nodecheck <name> <module-script> [args…]: passes when the script exits 0
  local name="$1" script="$2"; shift 2
  if node --input-type=module -e "$script" "$@" > "$WORK/nodecheck.txt" 2>&1; then PASS=$((PASS+1)); else echo "FAIL  $name"; sed 's/^/      /' "$WORK/nodecheck.txt"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1)); fi
}

echo "=== git: parseLinks and magic words ==="
nodecheck "parseLinks: branch, title and magic words" '
const { parseLinks } = await import("./dist/core/git.js");
const bad = [];
const eq = (what, got, want) => { const g = JSON.stringify([...got].sort()), w = JSON.stringify(want.sort()); if (g !== w) bad.push(`${what}: got ${g}, want ${w}`); };
const L = (branch, title, body = "") => parseLinks({ branch, title, body });
eq("key in branch",            L("parth/core-12-fix-login", "Fix login"), [["CORE-12", "closing"]]);
eq("key in title",             L("main", "CORE-3 tidy up"), [["CORE-3", "closing"]]);
eq("closing list",             L("x", "t", "Fixes CORE-1, CORE-2 and CORE-3"), [["CORE-1", "closing"], ["CORE-2", "closing"], ["CORE-3", "closing"]]);
eq("closing with colon",       L("x", "t", "Closes: CORE-4"), [["CORE-4", "closing"]]);
eq("every closing word",       L("x", "t", "resolved CORE-5\ncompletes CORE-6\nimplementing CORE-7"), [["CORE-5", "closing"], ["CORE-6", "closing"], ["CORE-7", "closing"]]);
eq("ref words",                L("x", "t", "Part of CORE-5. refs CORE-6. Contributes to CORE-7. towards CORE-8"), [["CORE-5", "ref"], ["CORE-6", "ref"], ["CORE-7", "ref"], ["CORE-8", "ref"]]);
eq("related",                  L("x", "t", "Related to CORE-8, relates to CORE-9"), [["CORE-8", "related"], ["CORE-9", "related"]]);
eq("ignore beats the title",   L("x", "CORE-9 something", "ignore CORE-9"), []);
eq("skip beats the branch",    L("me/core-10-x", "t", "skip CORE-10"), []);
eq("closing outranks ref",     L("x", "t", "refs CORE-11\nfixes CORE-11"), [["CORE-11", "closing"]]);
eq("a word beats the title",   L("x", "CORE-12 thing", "ref CORE-12"), [["CORE-12", "ref"]]);
eq("lower-case keys",          L("x", "t", "fixes core-13"), [["CORE-13", "closing"]]);
eq("no key, no link",          L("feature/login", "Fix login", "Just a description"), []);
eq("key mid-word in a branch", L("score-14x", "t"), []);
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
'

echo "=== git: prEvent ==="
nodecheck "prEvent maps PR state to automation events" '
const { prEvent } = await import("./dist/core/git.js");
const cases = [
  [{ state: "merged", reviewDecision: null, checks: null }, "merged"],
  [{ state: "closed", reviewDecision: "approved", checks: "success" }, null],
  [{ state: "draft", reviewDecision: null, checks: null }, "draft"],
  [{ state: "open", reviewDecision: null, checks: null }, "opened"],
  [{ state: "open", reviewDecision: "review_required", checks: null }, "review"],
  [{ state: "open", reviewDecision: "changes_requested", checks: "success" }, "review"],
  [{ state: "open", reviewDecision: "approved", checks: "success" }, "ready"],
  [{ state: "open", reviewDecision: "approved", checks: null }, "ready"],
  [{ state: "open", reviewDecision: "approved", checks: "pending" }, "review"],
  [{ state: "open", reviewDecision: "approved", checks: "failure" }, "review"],
];
const bad = cases.filter(([pr, want]) => prEvent(pr) !== want).map(([pr, want]) => `${JSON.stringify(pr)} → ${prEvent(pr)}, want ${want}`);
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
'

echo "=== git: KEY-NEW parsing ==="
nodecheck "parseNewIssueKeys and titleFromPr" '
const { parseNewIssueKeys, titleFromPr } = await import("./dist/core/git.js");
const bad = [];
const eq = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
eq("title",              parseNewIssueKeys({ title: "CORE-NEW Add export", body: "" }), ["CORE"]);
eq("title and body",     parseNewIssueKeys({ title: "[CORE-NEW] Add export", body: "also AGO-NEW, and CORE-NEW again" }), ["CORE", "AGO"]);
eq("prose is not a key", parseNewIssueKeys({ title: "A brand-new export", body: "renew the core-new cache" }), []);
eq("real keys are not NEW", parseNewIssueKeys({ title: "CORE-12 fix", body: "fixes CORE-13" }), []);
eq("strip prefix",       titleFromPr("CORE-NEW Add export"), "Add export");
eq("strip brackets",     titleFromPr("[CORE-NEW] Add export"), "Add export");
eq("strip colon",        titleFromPr("CORE-NEW: Add export"), "Add export");
eq("strip suffix",       titleFromPr("Add export (CORE-NEW)"), "Add export");
eq("only the marker",    titleFromPr("CORE-NEW"), "");
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
'

echo "=== git: ingest covers PR author, attribution, KEY-NEW and branch-copy start ==="
nodecheck "PR ingest assigns the author, files KEY-NEW issues, branch copy starts issues" '
const { createApp } = await import("./dist/server/index.js");
const { store } = createApp(process.argv[1]);
const git = store.ext.git;
const bad = [];
const ok = (what, cond) => { if (!cond) bad.push(what); };
const snap = () => store.snapshot();
const team = snap().teams.find(t => t.key === "CORE");
const state = (type, name) => snap().states.find(s => s.teamId === team.id && s.type === type && (!name || s.name === name));
const ada = snap().users.find(u => u.name === "Ada Osei");
const me = snap().currentUser;
store.updateUser(ada.id, { githubUsername: "@Ada-GH" });
ok("github username saved without @", snap().users.find(u => u.id === ada.id).githubUsername === "Ada-GH");
ok("login match is case-insensitive", git.userByGithub("ada-gh") === ada.id && git.userByGithub("nobody") === undefined && git.userByGithub("") === undefined);
let n = 0;
const pr = (o) => git.ingestPullRequest({ repo: "acme/app", number: ++n, title: "Change", body: "", url: `https://github.com/acme/app/pull/${n}`, state: "open", branch: "work", base: "main", author: "ada-gh", reviewDecision: null, checks: null, updatedAt: new Date().toISOString(), mergedAt: null, ...o });
const keyOf = (i) => `${team.key}-${i.number}`;
const issue = (id) => store.getIssue(id);

// an unassigned issue a PR closes goes to the PR author, and the activity is theirs
const a = store.createIssue({ teamId: team.id, title: "unassigned", stateId: state("backlog").id });
pr({ body: `Fixes ${keyOf(a)}` });
ok("author becomes assignee", issue(a.id).assigneeId === ada.id);
ok("opened PR moves to started", snap().states.find(s => s.id === issue(a.id).stateId).type === "started");
const acts = store.issueActivity(a.id);
ok("prLinked is by the author", acts.some(x => x.type === "prLinked" && x.userId === ada.id));
ok("status move is by the author", acts.some(x => x.type === "prStateMoved" && x.userId === ada.id));

// an assigned issue keeps its assignee; a ref link never assigns
const b = store.createIssue({ teamId: team.id, title: "mine", assigneeId: me.id, stateId: state("unstarted").id });
pr({ body: `Closes ${keyOf(b)}` });
ok("assignee kept", issue(b.id).assigneeId === me.id);
const c = store.createIssue({ teamId: team.id, title: "ref only", stateId: state("backlog").id });
pr({ body: `Part of ${keyOf(c)}` });
ok("ref link does not assign", issue(c.id).assigneeId === null);

// an unknown author stays the GitHub agent and assigns no one
const d = store.createIssue({ teamId: team.id, title: "stranger", stateId: state("backlog").id });
pr({ body: `Fixes ${keyOf(d)}`, author: "stranger" });
const bot = snap().users.find(u => u.kind === "agent" && u.name === "GitHub");
ok("unknown author: no assignee", issue(d.id).assigneeId === null);
ok("unknown author: GitHub agent acts", store.issueActivity(d.id).some(x => x.type === "prLinked" && x.userId === bot?.id));

// KEY-NEW: one new issue, started, assigned to the author, titled from the PR and linked, and never twice
const before = snap().issues.length;
const p = pr({ title: "CORE-NEW Add CSV export", body: "" });
const made = snap().issues.filter(i => i.title === "Add CSV export");
ok("KEY-NEW files one issue", made.length === 1 && snap().issues.length === before + 1);
const m = made[0];
ok("KEY-NEW issue is started", m && snap().states.find(s => s.id === m.stateId).type === "started");
ok("KEY-NEW issue belongs to the author", m && m.assigneeId === ada.id);
ok("KEY-NEW issue is linked", m && snap().issuePrs.some(l => l.issueId === m.id && l.prId === p.id && l.kind === "closing"));
git.ingestPullRequest({ ...p, state: "merged", mergedAt: new Date().toISOString() });
ok("re-sync files nothing new", snap().issues.filter(i => i.title === "Add CSV export").length === 1);
ok("KEY-NEW issue follows the PR to done", snap().states.find(s => s.id === issue(m.id).stateId).type === "completed");
pr({ title: "CORE-NEW Abandoned idea", state: "closed" });
ok("closed PR files nothing", !snap().issues.some(i => i.title === "Abandoned idea"));
pr({ title: "NOPE-NEW Unknown team" });
ok("unknown team files nothing", !snap().issues.some(i => i.title === "Unknown team"));

// branch copy: backlog / unstarted → first started state, unassigned → you; started issues stay put
const e = store.createIssue({ teamId: team.id, title: "copy me", stateId: state("backlog").id });
const r1 = store.startIssue(e.id, me.id);
ok("branch copy moves backlog to started", r1.moved && issue(e.id).stateId === state("started").id && r1.stateName === state("started").name);
ok("branch copy assigns you", r1.assigned && issue(e.id).assigneeId === me.id);
const r2 = store.startIssue(e.id, me.id);
ok("already started: no move", !r2.moved);
const f = store.createIssue({ teamId: team.id, title: "Ada has it", assigneeId: ada.id, stateId: state("unstarted").id });
const r3 = store.startIssue(f.id, me.id);
ok("unstarted moves, assignee kept", r3.moved && !r3.assigned && issue(f.id).assigneeId === ada.id);
const g = store.createIssue({ teamId: team.id, title: "done", stateId: state("completed").id });
ok("completed: no move", !store.startIssue(g.id, me.id).moved);
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
' "$WORK/git-flow.db"

echo "=== git: read-only, so only read commands reach gh / git ==="
nodecheck "assertReadOnly allows reads and refuses every write" '
const { assertReadOnly } = await import("./dist/core/git.js");
const ok = (c, a) => { try { assertReadOnly(c, a); return true; } catch { return false; } };
const reads = [["gh", ["--version"]], ["gh", ["api", "user", "--jq", ".login"]], ["gh", ["api", "-X", "GET", "repos/o/r"]], ["gh", ["api", "--method=GET", "repos/o/r"]],
  ["gh", ["pr", "list", "--repo", "o/r"]], ["gh", ["issue", "list", "--repo", "o/r"]], ["git", ["log", "-n", "5"]], ["git", ["remote", "get-url", "origin"]], ["git", ["symbolic-ref", "--short", "x"]]];
const writes = [["gh", ["pr", "comment", "1", "-b", "hi"]], ["gh", ["pr", "merge", "1"]], ["gh", ["issue", "create"]], ["gh", ["issue", "close", "3"]], ["gh", ["api", "-X", "POST", "repos/o/r/issues"]],
  ["gh", ["api", "repos/o/r/issues/1/comments", "-f", "body=hi"]], ["gh", ["api", "--method=PATCH", "repos/o/r"]], ["gh", ["api", "repos/o/r", "--input", "x.json"]], ["gh", ["api", "graphql"]],
  ["gh", ["label", "create", "x"]], ["git", ["push"]], ["git", ["remote", "add", "x", "y"]], ["git", ["commit", "-m", "x"]], ["curl", ["https://api.github.com"]]];
const bad = [...reads.filter(([c, a]) => !ok(c, a)).map(x => "refused read " + x[1].join(" ")), ...writes.filter(([c, a]) => ok(c, a)).map(x => "allowed write " + x[0] + " " + x[1].join(" "))];
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
'

echo "=== git: webhooks are signed, deduped and inbound only ==="
nodecheck "webhooks verify signatures, dedupe, and feed PRs, reviews, checks, pushes and issues" '
const { createHmac } = await import("node:crypto");
const { createApp } = await import("./dist/server/index.js");
const { app, store } = createApp(process.argv[1]);
const fail = m => { console.error(m); process.exit(1); };
const TUNNEL = "https://abc.trycloudflare.com/api/github/webhook";
let secret = "";
let n = 0;
const send = async (event, payload, { sig, id, url = TUNNEL } = {}) => {
  const raw = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json", "X-GitHub-Event": event, "X-GitHub-Delivery": id ?? `d-${++n}` };
  const s = sig === undefined ? "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") : sig;
  if (s) headers["X-Hub-Signature-256"] = s;
  const r = await app.request(url, { method: "POST", headers, body: raw });
  return { status: r.status, body: await r.json() };
};
const w = store.ext.webhooks;
const issue = store.listIssues({}).find(i => !i.deletedAt);
const team = store.snapshot().teams.find(t => t.id === issue.teamId);
const key = `${team.key}-${issue.number}`;
const repository = { full_name: "acme/app", default_branch: "main" };
const pr = (extra = {}) => ({ number: 7, title: `${key} webhook test`, body: "", html_url: "https://github.com/acme/app/pull/7", state: "open", draft: false, merged: false, merged_at: null, head: { ref: "feat" }, base: { ref: "main" }, user: { login: "octo" }, updated_at: new Date().toISOString(), ...extra });

if ((await send("ping", { zen: "x" }, { sig: "sha256=00" })).status !== 404) fail("webhooks should be off until a secret exists");
store.setFeatures({ githubEnabled: true });
secret = w.rotateSecret();
if ((await send("ping", { zen: "hi", repository })).status !== 200) fail("signed ping from a tunnel host should be accepted");
if ((await send("ping", { zen: "hi" }, { sig: "sha256=" + "0".repeat(64) })).status !== 401) fail("a bad signature should be rejected");
if ((await send("ping", { zen: "hi" }, { sig: "" })).status !== 401) fail("an unsigned request should be rejected");
if (w.config().rejected !== 2) fail("rejections should be logged");

const opened = await send("pull_request", { action: "opened", pull_request: pr(), repository }, { id: "same" });
if (opened.status !== 200) fail("PR opened: " + JSON.stringify(opened));
const snap = () => store.snapshot();
const p7 = () => snap().pullRequests.find(p => p.repo === "acme/app" && p.number === 7);
if (!p7() || !snap().issuePrs.some(l => l.issueId === issue.id && l.prId === p7().id)) fail("PR should be stored and linked to " + key);
const dup = await send("pull_request", { action: "opened", pull_request: pr({ title: "changed" }), repository }, { id: "same" });
if (!dup.body.duplicate || p7().title === "changed") fail("a repeated delivery should be ignored");

await send("pull_request_review", { action: "submitted", review: { state: "approved" }, pull_request: pr(), repository });
if (p7().reviewDecision !== "approved") fail("review approved should set the decision, got " + p7().reviewDecision);
await send("check_suite", { action: "completed", check_suite: { status: "completed", conclusion: "failure", pull_requests: [{ number: 7 }] }, repository });
if (p7().checks !== "failure") fail("a failed check suite should mark checks failed");
await send("pull_request", { action: "closed", pull_request: pr({ state: "closed", merged: true, merged_at: new Date().toISOString() }), repository });
if (p7().state !== "merged" || p7().reviewDecision !== "approved") fail("merge should keep the review decision, got " + JSON.stringify(p7()));

const push = await send("push", { ref: "refs/heads/main", repository, commits: [{ id: "abc1234def", message: `fixes ${key}`, timestamp: new Date().toISOString(), author: { username: "octo" } }] });
if (!snap().issueCommits.some(c => c.issueId === issue.id && c.sha === "abc1234def")) fail("push should link the commit: " + JSON.stringify(push));

if ((await send("issues", { action: "opened", issue: { number: 99, title: "From GitHub", body: "b", html_url: "https://github.com/acme/app/issues/99", user: { login: "octo" }, labels: [] }, repository })).status !== 202) fail("issues from a repo nobody follows should be ignored");
w.setFollow("acme/app", team.id);
await send("issues", { action: "opened", issue: { number: 99, title: "From GitHub", body: "b", html_url: "https://github.com/acme/app/issues/99", user: { login: "octo" }, labels: [] }, repository });
const imported = store.listIssues({ teamId: team.id }).find(i => i.title === "From GitHub");
if (!imported || !imported.description.includes("acme/app#99")) fail("a followed repo’s new issue should be imported");
await send("issues", { action: "closed", issue: { number: 99, title: "From GitHub" }, repository });
if (snap().states.find(s => s.id === store.getIssue(imported.id).stateId)?.type !== "completed") fail("closing it on GitHub should complete it here");

// the exemption is the webhook POST only. Everything else from a foreign host is still refused
if ((await app.request("https://abc.trycloudflare.com/api/bootstrap")).status !== 403) fail("foreign host GET bootstrap must stay 403");
if ((await app.request("https://abc.trycloudflare.com/api/github/webhook/config")).status !== 403) fail("foreign host webhook config must stay 403");
if ((await app.request(TUNNEL)).status !== 403) fail("foreign host GET on the webhook path must stay 403");
w.turnOff();
if ((await send("ping", { zen: "x" })).status !== 404) fail("turned off: deliveries should be refused");
' "$WORK/webhooks.db"
check "git webhook shows setup" "Payload URL" git webhook
check "git webhook --rotate prints a secret once" "Secret (shown once)" git webhook --rotate
check_rc "git webhook --url refuses plain http" 1 git webhook --url http://example.com
check_rc "git import-issues refuses a malformed repo" 1 git import-issues not-a-repo -t CORE

echo "=== initiatives: update reminders and reactions ==="
nodecheck "initiative owners get one reminder when an update is due" '
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { createApp } = require("./dist/server/index.js");
const { store } = createApp(process.argv[1]);
const me = store.workspaceMeta().currentUser;
const pl = store.ext.planning;
const ini = pl.createInitiative({ name: "Remind me", ownerId: me, updateCadence: "weekly" });
const reminders = () => { store.tick(); return store.snapshot().notifications.filter(n => n.type === "initiativeUpdateReminder" && n.body.startsWith(ini.id + "|")); };
if (reminders().length) throw new Error("reminded before the update was due");
store.db.prepare("UPDATE initiatives SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 9 * 86400000).toISOString(), ini.id);
if (reminders().length !== 1) throw new Error("no reminder once due");
if (reminders().length !== 1) throw new Error("reminded twice for one due date");
const u = pl.addInitiativeUpdate(ini.id, me, "On it", "onTrack");
if (pl.updateDueAt(store.snapshot().initiatives.find(i => i.id === ini.id)) <= new Date().toISOString()) throw new Error("posting an update did not move the due date");
pl.toggleUpdateReaction(u.id, "🎉", me);
if (store.snapshot().initiativeUpdates.find(x => x.id === u.id).reactions["🎉"]?.[0] !== me) throw new Error("reaction not stored");
pl.toggleUpdateReaction(u.id, "🎉", me);
if (Object.keys(store.snapshot().initiativeUpdates.find(x => x.id === u.id).reactions).length) throw new Error("reaction not removed");
' "$WORK/ini-remind.db"

echo "=== user update --github ==="
check "user update sets a GitHub username" "github:ada-gh" user update Ada --github ada-gh
check "user list shows the GitHub username" "github:ada-gh" user list

echo "=== connect ==="
CREPO="$WORK/connect-repo"; mkdir -p "$CREPO"
printf '{ "mcpServers": { "other": { "command": "x" } } }\n' > "$CREPO/.mcp.json"
# a PATH with node and nothing else of this machine's, so no installed `baseline` is found
mkdir -p "$WORK/nodeonly"; ln -sf "$(command -v node)" "$WORK/nodeonly/node"
NOPATH="$WORK/nodeonly:/usr/bin:/bin"
# `baseline` is not on that PATH: connect refuses and writes nothing
NOPATH_OUT=$(PATH="$NOPATH" $BIN connect claude --dir "$CREPO" 2>&1); NOPATH_RC=$?
if [[ $NOPATH_RC -ne 0 && "$NOPATH_OUT" == *"not on your PATH"* && "$NOPATH_OUT" == *"npm install -g"* && "$NOPATH_OUT" == *"claude mcp add --scope local"* && ! -e "$CREPO/CLAUDE.md" ]] && ! grep -q baseline "$CREPO/.mcp.json"; then PASS=$((PASS+1)); else echo "FAIL  connect without baseline on PATH refuses, says how to install, writes nothing"; echo "      got: $NOPATH_OUT"; FAILED_NAMES+=("connect not on PATH"); FAIL=$((FAIL+1)); fi
# a stand-in `baseline` on PATH, as after npm install -g
mkdir -p "$WORK/shim"; printf '#!/bin/sh\nexit 0\n' > "$WORK/shim/baseline"; chmod +x "$WORK/shim/baseline"
SHIMPATH="$WORK/shim:$PATH"
cs() { PATH="$SHIMPATH" $BIN "$@"; }
ccheck() { # ccheck <name> <expected-substring> <args…>: connect with `baseline` on PATH
  local name="$1" expect="$2"; shift 2
  local out; out=$(cs "$@" 2>&1); local rc=$?
  if [[ $rc -eq 0 && "$out" == *"$expect"* ]]; then PASS=$((PASS+1)); else echo "FAIL  $name (exit $rc)"; echo "      got: $(echo "$out" | head -3 | tr '\n' '|')"; FAILED_NAMES+=("$name"); FAIL=$((FAIL+1)); fi
}
ccheck "connect --dry-run lists the files" "would create CLAUDE.md" connect claude --dir "$CREPO" --dry-run
if [[ ! -e "$CREPO/CLAUDE.md" ]]; then PASS=$((PASS+1)); else echo "FAIL  connect --dry-run writes nothing"; FAILED_NAMES+=("connect dry run"); FAIL=$((FAIL+1)); fi
ccheck "connect claude says what it changed" "updated .mcp.json" connect claude --dir "$CREPO"
check_json "connect keeps other MCP servers and writes the portable \`baseline mcp\`" "$CREPO/.mcp.json" "d.mcpServers.other.command==='x'&&d.mcpServers.baseline.command==='baseline'&&d.mcpServers.baseline.args.join(' ')==='mcp'"
ccheck "connect claude again changes nothing" "nothing changed" connect claude --dir "$CREPO"
ccheck "connect codex writes the project config" "created .codex/config.toml" connect codex --dir "$CREPO"
if grep -q 'command = "baseline"' "$CREPO/.codex/config.toml" && grep -q 'env_vars = \["BASELINE_DB", "BASELINE_URL", "BASELINE_TOKEN"' "$CREPO/.codex/config.toml" && grep -q 'default_tools_approval_mode = "writes"' "$CREPO/.codex/config.toml" && grep -q 'baseline:agent-tracking:end' "$CREPO/AGENTS.md"; then PASS=$((PASS+1)); else echo "FAIL  connect codex: command, forwarded env names, approval mode and AGENTS.md block"; FAILED_NAMES+=("connect codex"); FAIL=$((FAIL+1)); fi
ccheck "connect pi writes .pi/mcp.json (the AGENTS.md block is already there)" "created .pi/mcp.json" connect pi --dir "$CREPO"
check_json "connect pi: \`baseline mcp\`, tools shown directly" "$CREPO/.pi/mcp.json" "d.mcpServers.baseline.command==='baseline'&&d.mcpServers.baseline.args.join(' ')==='mcp'&&d.mcpServers.baseline.exposure==='direct'"
ccheck "connect pi again changes nothing" "nothing changed" connect pi --dir "$CREPO"
DB_OUT=$(cs connect pi --dir "$CREPO" --db "$WORK/x.db" 2>&1); DB_RC=$?
if [[ $DB_RC -ne 0 && "$DB_OUT" == *"BASELINE_DB"* ]] && ! grep -rq -- '--db\|x\.db' "$CREPO"; then PASS=$((PASS+1)); else echo "FAIL  connect --db is refused, and no database path lands in the repo"; FAILED_NAMES+=("connect --db"); FAIL=$((FAIL+1)); fi
if ! grep -rqE "$WORK|/Users/|node_modules" "$CREPO/.mcp.json" "$CREPO/.codex/config.toml" "$CREPO/.pi/mcp.json"; then PASS=$((PASS+1)); else echo "FAIL  shared MCP configs hold a machine path"; FAILED_NAMES+=("connect machine paths"); FAIL=$((FAIL+1)); fi
# --remote: the server's /mcp URL, the key read from $BASELINE_TOKEN, never written
RREPO="$WORK/remote-repo"; mkdir -p "$RREPO"
RTOKEN="bl_secret_never_in_files"
for agent in claude codex pi; do
  out=$(env -u BASELINE_DB BASELINE_URL=http://127.0.0.1:7999 BASELINE_TOKEN="$RTOKEN" PATH="$NOPATH" $BIN connect $agent --dir "$RREPO" --remote 2>&1); rc=$?
  if [[ $rc -eq 0 && "$out" == *"BASELINE_TOKEN"* ]]; then PASS=$((PASS+1)); else echo "FAIL  connect $agent --remote (exit $rc)"; echo "      got: $out"; FAILED_NAMES+=("connect $agent --remote"); FAIL=$((FAIL+1)); fi
done
check_json "connect claude --remote: http entry with \${BASELINE_TOKEN}" "$RREPO/.mcp.json" "d.mcpServers.baseline.type==='http'&&d.mcpServers.baseline.url==='http://127.0.0.1:7999/mcp'&&d.mcpServers.baseline.headers.Authorization==='Bearer \${BASELINE_TOKEN}'"
if grep -q 'url = "http://127.0.0.1:7999/mcp"' "$RREPO/.codex/config.toml" && grep -q 'bearer_token_env_var = "BASELINE_TOKEN"' "$RREPO/.codex/config.toml"; then PASS=$((PASS+1)); else echo "FAIL  connect codex --remote: url + bearer_token_env_var"; FAILED_NAMES+=("connect codex --remote file"); FAIL=$((FAIL+1)); fi
check_json "connect pi --remote: url + Authorization from \${BASELINE_TOKEN}" "$RREPO/.pi/mcp.json" "d.mcpServers.baseline.url==='http://127.0.0.1:7999/mcp'&&d.mcpServers.baseline.headers.Authorization==='Bearer \${BASELINE_TOKEN}'"
if ! grep -rq "$RTOKEN" "$RREPO"; then PASS=$((PASS+1)); else echo "FAIL  the API key was written into the repo"; FAILED_NAMES+=("connect --remote token"); FAIL=$((FAIL+1)); fi
LOCAL_OUT=$(BASELINE_DB="$WORK/l.db" $BIN connect claude --dir "$RREPO" --remote 2>&1); LOCAL_RC=$?
if [[ $LOCAL_RC -ne 0 && "$LOCAL_OUT" == *"baseline login"* ]]; then PASS=$((PASS+1)); else echo "FAIL  connect --remote against a local database says to log in"; FAILED_NAMES+=("connect --remote local"); FAIL=$((FAIL+1)); fi

echo
echo "================================"
echo "PASS: $PASS  FAIL: $FAIL"
if [[ $FAIL -gt 0 ]]; then
  echo "failed: ${FAILED_NAMES[*]}"
  exit 1
fi
echo "ALL CLI TESTS PASSED"
