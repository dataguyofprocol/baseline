// Every /api route (and /mcp), with what an API key needs to call it and how a team-limited key is kept to its
// teams. scripts/test-route-policy.ts fails when a registered route is missing here (or a row names
// a route that no longer exists), and checks each row against what the middleware actually does:
// the scope against ApiKeys.missingScope, the team rule by calling the route with a key limited to
// another team. A new route can't fail open for a team-limited key without someone writing it down.

/** the narrowest key permission that may call the route (as ApiKeys.missingScope decides) */
export type KeyScope = 'read' | 'write' | 'admin';

export type TeamRule =
  /** an issue id in the path: the key's teams are checked against the issue's team */
  | 'issue'
  /** a team id in the path */
  | 'team'
  /** an uploaded file or attachment id in the path: checked against its issue's (or team's) team */
  | 'file'
  /** body.teamId, body.teamIds (or body.ids, for bulk) is checked; nothing in the path names a team */
  | 'body'
  /** a read whose JSON response is filtered down to the key's teams */
  | 'response'
  /** not team data: the workspace, its people and settings, the caller's own things */
  | 'workspace'
  /** a key is refused outright (keys can't manage keys or approve CLI sign-ins) */
  | 'keyless'
  /** the MCP endpoint: keys only, and each tool call is an /api request made with the same key,
   *  so that route's own row keeps a team-limited key to its teams */
  | 'mcp'
  /** outside authenticate: signed some other way (GitHub's HMAC) */
  | 'public'
  /** team data addressed by an id the middleware can't map to a team (a comment, a project, a cycle…).
   *  A team-limited key is NOT kept to its teams here: known gaps, listed so they stay visible. */
  | 'unchecked';

export interface RoutePolicy { scope: KeyScope; team: TeamRule }

export const ROUTE_POLICY: Record<string, RoutePolicy> = {
  'POST /api/github/webhook': { scope: 'write', team: 'public' },
  'POST /api/auth/logout': { scope: 'write', team: 'workspace' },
  'GET /api/api-keys': { scope: 'read', team: 'keyless' },
  'POST /api/api-keys': { scope: 'write', team: 'keyless' },
  'PATCH /api/api-keys/:id': { scope: 'write', team: 'keyless' },
  'DELETE /api/api-keys/:id': { scope: 'write', team: 'keyless' },
  'POST /api/cli-auth/approve': { scope: 'write', team: 'keyless' },
  'GET /api/me': { scope: 'read', team: 'workspace' },
  // Streamable HTTP MCP (src/mcp/http.ts): POST carries the JSON-RPC, GET a stream, DELETE ends the session
  'POST /mcp': { scope: 'read', team: 'mcp' },
  'GET /mcp': { scope: 'read', team: 'mcp' },
  'DELETE /mcp': { scope: 'read', team: 'mcp' },
  'DELETE /api/me/key': { scope: 'write', team: 'workspace' },
  'POST /api/me/password': { scope: 'write', team: 'keyless' },
  'GET /api/events': { scope: 'read', team: 'workspace' },
  'GET /api/bootstrap': { scope: 'read', team: 'response' },
  'GET /api/search': { scope: 'read', team: 'response' },

  // issues
  'GET /api/issues': { scope: 'read', team: 'response' },
  'POST /api/issues': { scope: 'write', team: 'body' },
  'POST /api/issues/bulk': { scope: 'write', team: 'body' },
  'GET /api/issues/by-key/:key': { scope: 'read', team: 'response' },
  'GET /api/issues/archived': { scope: 'read', team: 'response' },
  'GET /api/issues/deleted': { scope: 'read', team: 'response' },
  'GET /api/issues/:id': { scope: 'read', team: 'issue' },
  'PATCH /api/issues/:id': { scope: 'write', team: 'issue' },
  'DELETE /api/issues/:id': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/restore': { scope: 'write', team: 'issue' },
  'DELETE /api/issues/:id/purge': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/convert-project': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/team': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/snooze': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/remind': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/subscribe': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/attachments': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/archive': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/unarchive': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/move': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/start': { scope: 'write', team: 'issue' },
  'GET /api/issues/:id/handoff': { scope: 'read', team: 'issue' },
  'POST /api/issues/:id/open-claude': { scope: 'admin', team: 'issue' },
  'POST /api/issues/:id/comments': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/relations': { scope: 'write', team: 'issue' },
  // agent work (core/work.ts); a follow-up's body.teamId is checked too
  'POST /api/issues/:id/work/start': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/work/progress': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/work/finish': { scope: 'write', team: 'issue' },
  'POST /api/issues/:id/followups': { scope: 'write', team: 'issue' },
  'GET /api/issues/:id/work': { scope: 'read', team: 'issue' },
  // an op id names no team for the middleware; the route itself refuses a team-limited key's undo outside its teams
  'POST /api/ops/:id/undo': { scope: 'write', team: 'unchecked' },
  'PATCH /api/comments/:id': { scope: 'write', team: 'unchecked' },
  'DELETE /api/comments/:id': { scope: 'write', team: 'unchecked' },
  'DELETE /api/relations/:id': { scope: 'write', team: 'unchecked' },
  'POST /api/git/unlink': { scope: 'write', team: 'unchecked' },

  // images and attachments
  'POST /api/files': { scope: 'write', team: 'unchecked' },
  'GET /api/files/:id/:name?': { scope: 'read', team: 'file' },
  'GET /api/attachments/:id/:name': { scope: 'read', team: 'file' },
  'GET /api/emoji-files/:id/:name': { scope: 'read', team: 'file' },
  'PATCH /api/attachments/:id': { scope: 'write', team: 'file' },
  'DELETE /api/attachments/:id': { scope: 'write', team: 'file' },

  // teams and their setup
  'POST /api/teams': { scope: 'admin', team: 'workspace' },
  'PATCH /api/teams/:id': { scope: 'admin', team: 'team' },
  'DELETE /api/teams/:id': { scope: 'admin', team: 'team' },
  'PUT /api/teams/:id/workflow': { scope: 'write', team: 'team' },
  'PUT /api/teams/:id/subscription': { scope: 'write', team: 'team' },
  'POST /api/teams/:id/join': { scope: 'write', team: 'team' },
  'POST /api/teams/:id/leave': { scope: 'write', team: 'team' },
  'POST /api/teams/:id/members': { scope: 'write', team: 'team' },
  'DELETE /api/teams/:id/members/:userId': { scope: 'write', team: 'team' },
  'POST /api/teams/:id/links': { scope: 'write', team: 'team' },
  'DELETE /api/team-links/:id': { scope: 'write', team: 'unchecked' },
  'GET /api/git/automation/:teamId': { scope: 'read', team: 'team' },
  'PUT /api/git/automation/:teamId': { scope: 'admin', team: 'team' },
  'POST /api/states': { scope: 'admin', team: 'body' },
  'PATCH /api/states/:id': { scope: 'admin', team: 'unchecked' },
  'DELETE /api/states/:id': { scope: 'admin', team: 'unchecked' },
  'POST /api/labels': { scope: 'write', team: 'body' },
  'PATCH /api/labels/:id': { scope: 'write', team: 'unchecked' },
  'DELETE /api/labels/:id': { scope: 'write', team: 'unchecked' },
  'GET /api/issue-templates': { scope: 'read', team: 'response' },
  'POST /api/issue-templates': { scope: 'write', team: 'body' },
  'PATCH /api/issue-templates/:id': { scope: 'write', team: 'unchecked' },
  'DELETE /api/issue-templates/:id': { scope: 'write', team: 'unchecked' },
  'POST /api/cycles': { scope: 'write', team: 'body' },
  'PATCH /api/cycles/:id': { scope: 'write', team: 'unchecked' },
  'DELETE /api/cycles/:id': { scope: 'write', team: 'unchecked' },
  'POST /api/recurring': { scope: 'write', team: 'body' },
  'PATCH /api/recurring/:id': { scope: 'write', team: 'unchecked' },
  'DELETE /api/recurring/:id': { scope: 'write', team: 'unchecked' },
  'POST /api/sla-rules': { scope: 'admin', team: 'body' },
  'PATCH /api/sla-rules/:id': { scope: 'admin', team: 'unchecked' },
  'DELETE /api/sla-rules/:id': { scope: 'admin', team: 'unchecked' },
  'POST /api/views': { scope: 'write', team: 'body' },
  'PATCH /api/views/:id': { scope: 'write', team: 'unchecked' },
  'DELETE /api/views/:id': { scope: 'write', team: 'unchecked' },

  // projects, docs, milestones
  'POST /api/projects': { scope: 'write', team: 'body' },
  'PATCH /api/projects/:id': { scope: 'write', team: 'unchecked' },
  'DELETE /api/projects/:id': { scope: 'write', team: 'unchecked' },
  'GET /api/projects/:id/progress': { scope: 'read', team: 'unchecked' },
  'POST /api/projects/:id/updates': { scope: 'write', team: 'unchecked' },
  'PATCH /api/project-updates/:id': { scope: 'write', team: 'unchecked' },
  'DELETE /api/project-updates/:id': { scope: 'write', team: 'unchecked' },
  'GET /api/projects/:id/update-draft': { scope: 'read', team: 'unchecked' },
  'PUT /api/projects/:id/update-draft': { scope: 'write', team: 'unchecked' },
  'DELETE /api/projects/:id/update-draft': { scope: 'write', team: 'unchecked' },
  // a person publishes a draft from the web app; a key is refused, whatever its scopes
  'POST /api/projects/:id/update-draft/publish': { scope: 'write', team: 'keyless' },
  'POST /api/projects/:id/links': { scope: 'write', team: 'unchecked' },
  'DELETE /api/project-links/:id': { scope: 'write', team: 'unchecked' },
  'PUT /api/projects/:id/subscription': { scope: 'write', team: 'unchecked' },
  'POST /api/milestones': { scope: 'write', team: 'unchecked' },
  'PATCH /api/milestones/:id': { scope: 'write', team: 'unchecked' },
  'DELETE /api/milestones/:id': { scope: 'write', team: 'unchecked' },
  'POST /api/docs': { scope: 'write', team: 'body' },
  'PATCH /api/docs/:id': { scope: 'write', team: 'unchecked' },
  'DELETE /api/docs/:id': { scope: 'write', team: 'unchecked' },
  'POST /api/project-labels': { scope: 'write', team: 'workspace' },
  'PATCH /api/project-labels/:id': { scope: 'write', team: 'workspace' },
  'DELETE /api/project-labels/:id': { scope: 'write', team: 'workspace' },
  'POST /api/project-statuses': { scope: 'write', team: 'workspace' },
  'PATCH /api/project-statuses/:id': { scope: 'write', team: 'workspace' },
  'DELETE /api/project-statuses/:id': { scope: 'write', team: 'workspace' },

  // initiatives span teams
  'POST /api/initiatives': { scope: 'write', team: 'workspace' },
  'PATCH /api/initiatives/:id': { scope: 'write', team: 'workspace' },
  'DELETE /api/initiatives/:id': { scope: 'write', team: 'workspace' },
  'POST /api/initiatives/:id/projects': { scope: 'write', team: 'workspace' },
  'DELETE /api/initiatives/:id/projects/:projectId': { scope: 'write', team: 'workspace' },
  'POST /api/initiatives/:id/updates': { scope: 'write', team: 'workspace' },
  'PATCH /api/initiative-updates/:id': { scope: 'write', team: 'workspace' },
  'DELETE /api/initiative-updates/:id': { scope: 'write', team: 'workspace' },
  'POST /api/initiatives/:id/links': { scope: 'write', team: 'workspace' },
  'DELETE /api/initiative-links/:id': { scope: 'write', team: 'workspace' },
  'POST /api/initiative-labels': { scope: 'write', team: 'workspace' },
  'PATCH /api/initiative-labels/:id': { scope: 'write', team: 'workspace' },
  'DELETE /api/initiative-labels/:id': { scope: 'write', team: 'workspace' },


  // the person's own things
  'POST /api/favorites/toggle': { scope: 'write', team: 'workspace' },
  'GET /api/notifications': { scope: 'read', team: 'unchecked' },
  'POST /api/notifications/:id/read': { scope: 'write', team: 'workspace' },
  'POST /api/notifications/read-all': { scope: 'write', team: 'workspace' },
  'POST /api/notifications/delete-read': { scope: 'write', team: 'workspace' },
  'DELETE /api/notifications/:id': { scope: 'write', team: 'workspace' },
  'POST /api/notifications/:id/snooze': { scope: 'write', team: 'workspace' },
  'PATCH /api/preferences': { scope: 'write', team: 'workspace' },

  // people and workspace settings
  'POST /api/users': { scope: 'admin', team: 'workspace' },
  'PATCH /api/users/:id': { scope: 'admin', team: 'workspace' },
  'POST /api/users/:id/avatar': { scope: 'admin', team: 'workspace' },
  'GET /api/invites': { scope: 'read', team: 'workspace' },
  'POST /api/invites': { scope: 'write', team: 'body' },
  'POST /api/invites/:id/resend': { scope: 'write', team: 'workspace' },
  'DELETE /api/invites/:id': { scope: 'write', team: 'workspace' },
  'PATCH /api/members/:id': { scope: 'write', team: 'workspace' },
  'POST /api/members/:id/reset-link': { scope: 'write', team: 'keyless' },
  'PATCH /api/security': { scope: 'write', team: 'workspace' },
  'PATCH /api/workspace': { scope: 'admin', team: 'workspace' },
  'PATCH /api/features': { scope: 'admin', team: 'workspace' },
  'GET /api/export': { scope: 'admin', team: 'unchecked' },
  'POST /api/import': { scope: 'admin', team: 'unchecked' },
  'POST /api/seed': { scope: 'admin', team: 'unchecked' },

  // this machine: folders, terminals, locations, automation, git
  'GET /api/terminals': { scope: 'read', team: 'workspace' },
  'POST /api/directories/pick': { scope: 'admin', team: 'workspace' },
  'POST /api/directories/check': { scope: 'admin', team: 'workspace' },
  'POST /api/locations': { scope: 'admin', team: 'workspace' },
  'PATCH /api/locations/:id': { scope: 'admin', team: 'workspace' },
  'DELETE /api/locations/:id': { scope: 'admin', team: 'workspace' },
  'POST /api/loops': { scope: 'admin', team: 'workspace' },
  'PATCH /api/loops/:id': { scope: 'admin', team: 'workspace' },
  'DELETE /api/loops/:id': { scope: 'admin', team: 'workspace' },
  'POST /api/loops/:id/run': { scope: 'admin', team: 'unchecked' },
  'GET /api/git/status': { scope: 'read', team: 'workspace' },
  'POST /api/git/sync': { scope: 'admin', team: 'workspace' },
  'POST /api/git/pull-requests': { scope: 'admin', team: 'unchecked' },
  'POST /api/git/commits': { scope: 'admin', team: 'unchecked' },
  'PUT /api/github/token': { scope: 'admin', team: 'workspace' },
  'DELETE /api/github/token': { scope: 'admin', team: 'workspace' },
  'GET /api/github/repos/available': { scope: 'admin', team: 'workspace' },
  'PUT /api/github/repos': { scope: 'admin', team: 'workspace' },
  'GET /api/github/webhook/config': { scope: 'read', team: 'workspace' },
  'PUT /api/github/webhook/config': { scope: 'admin', team: 'workspace' },
  'POST /api/github/webhook/secret': { scope: 'admin', team: 'workspace' },
  'DELETE /api/github/webhook/secret': { scope: 'admin', team: 'workspace' },
  'GET /api/github/webhook/deliveries': { scope: 'read', team: 'workspace' },
  'POST /api/github/issues/import': { scope: 'admin', team: 'body' },
  'PUT /api/github/issues/follow': { scope: 'admin', team: 'body' },
};
