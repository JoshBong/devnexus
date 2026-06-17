# Configuration Reference

devnexus uses two configuration layers: workspace config and vault registration.

## .workspace-config

JSON file at the workspace root. Created by `devnexus init`, updated by most commands.

```json
{
  "projectName": "my-project",
  "vaultName": "my-project-vault",
  "repos": [
    {
      "name": "frontend",
      "path": "./frontend",
      "url": "git@github.com:team/frontend.git"
    },
    {
      "name": "backend",
      "path": "./backend",
      "url": "git@github.com:team/backend.git"
    }
  ],
  "agents": ["claude", "cursor"],
  "techStack": ["Next.js", "FastAPI", "Supabase", "TypeScript", "Python"],
  "description": "E-commerce platform",
  "author": "Alice",
  "templateVersion": "1.6.1",
  "lastIndexed": "2026-04-15T10:30:00Z",
  "indexStats": {
    "symbols": 245,
    "communities": 8,
    "godNodes": 3,
    "bridges": 5
  },
  "indexSnapshot": {
    "godNodes": ["DealState", "ApiRouter", "AuthService"],
    "communities": ["auth", "api", "models", "utils"]
  }
}
```

| Field | Description |
|-------|------------|
| `projectName` | Workspace name |
| `vaultName` | Obsidian vault folder name |
| `repos` | Tracked repositories (name, path, optional URL) |
| `agents` | Configured AI agents |
| `techStack` | Detected or declared tech stack |
| `description` | Project description |
| `author` | Who initialized the workspace |
| `templateVersion` | Current `.ai-rules/` template version |
| `lastIndexed` | When `devnexus index` last ran |
| `indexStats` | Symbol, community, god node, bridge counts from last index |
| `indexSnapshot` | God node names and community names from last index (used for diff) |

## Vault Registration (~/.claude/vault-map.json)

Maps vault names to paths so the vault-encoder hook can find them.

```json
{
  "my-project-vault": "/Users/alice/my-project/my-project-vault"
}
```

Updated by `devnexus init`. Checked by `devnexus doctor`.

## Next Steps

- **Full command reference** → [Commands](commands.md)
- **What the vault contains** → [Vault Structure](vault-structure.md)
- **Diagnosing problems** → run `devnexus doctor`
