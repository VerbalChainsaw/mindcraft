# Companion validation

Single supported validation entry point for the active Minecraft bot worktree.

- Active worktree: `C:\Users\zerop\Development\minecraft-companion-brain-v2`
- Active branch: `architecture/machine-brain-v2`
- Frozen baseline: `C:\Users\zerop\Development\minecraft-companion`

```powershell
npm run validate:quick
npm run validate:tree
npm run validate:all
```

Use a JSON plan to avoid shell quoting and argument-length problems:

```json
{
  "suite": "tree",
  "fixtureRoot": "C:\\Users\\zerop\\Development\\JordanWorkspace\\artifacts\\minecraft-validation\\fixtures\\doorway-corridor-follow-v1",
  "outputRoot": "C:\\Users\\zerop\\Development\\JordanWorkspace\\artifacts\\minecraft-validation\\results",
  "actionTimeoutMs": 120000
}
```

```powershell
node tools/validate-companion.mjs --plan C:\path\validation-plan.json
```

This entry point owns isolated startup, world restoration, execution, shutdown, process cleanup, and restoration of normal bot memory and managed-server configuration. Existing `verify-*-field.mjs` and Scenario Lab adapters are internal implementations, not competing entry points.

The local managed-server batch API `/api/minecraft-server/commands` accepts an ordered JSON command array, commands up to 2048 characters, and an optional settle delay. This removes shell parsing, command-length, and command-race barriers without allowing lifecycle/reload commands through the gameplay console.
