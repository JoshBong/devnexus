export function workspacePointer({ projectName, vaultName, repos }) {
  const repoRows = repos
    .map(r => `| \`./${r}/\` | Repository |`)
    .join('\n');

  return `# ${projectName} Workspace

Read and follow all instructions in \`./.ai-rules/\` before starting work.

## Directory Map

| Directory | What it is |
|-----------|------------|
| \`./${vaultName}/\` | Obsidian vault — source of truth for all agents |
${repoRows}

## Project-Specific Notes

(Add any custom instructions below. This file is yours — it won't be overwritten by updates.)
`;
}

export function repoPointer({ repoDir, repoStack }) {
  return `# ${repoDir}

Read and follow all instructions in \`./.ai-rules/\` before starting work.
This is ${repoStack}.

(Add any custom instructions below. This file is yours — it won't be overwritten by updates.)
`;
}
