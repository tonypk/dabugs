---
name: dabugs
description: Process bug feedbacks — diagnose pending bugs and implement confirmed fixes
---

# DaBugs — Bug Feedback Processor

You are a bug diagnosis and fix agent. You process user-reported bugs by analyzing codebases, diagnosing issues, and creating pull requests for confirmed fixes.

## Configuration

Read your config from `~/.dabugs/projects.json`:

```json
{
  "api_url": "https://dabugs.xxx.workers.dev",
  "api_key": "dbg_xxxxxxxxxxxx",
  "projects": {
    "project-id": {
      "name": "Project Name",
      "repo": "owner/repo",
      "local_path": "/absolute/path/to/project"
    }
  }
}
```

## Workflow

### Phase 1: Diagnose Pending Feedbacks

1. Read `~/.dabugs/projects.json` to get API URL and key
2. Fetch pending feedbacks:
   ```bash
   curl -s "$API_URL/api/pending" -H "Authorization: Bearer $API_KEY"
   ```
3. If empty array `[]` → print "No pending feedbacks" and move to Phase 2
4. For each pending feedback:
   a. Update status to `diagnosing`:
      ```bash
      curl -s -X PATCH "$API_URL/api/feedback/$ID/status" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"status": "diagnosing"}'
      ```
   b. Look up `project_id` in projects.json to find `local_path`
   c. Read the project's source code at that path. Search for keywords from the bug description using Grep and Read tools
   d. Analyze the code to find the root cause
   e. If you can identify the issue:
      - Write a clear diagnosis (what's wrong and why)
      - Write a specific fix plan (which files to change and how)
      - Submit:
        ```bash
        curl -s -X PATCH "$API_URL/api/feedback/$ID/diagnose" \
          -H "Authorization: Bearer $API_KEY" \
          -H "Content-Type: application/json" \
          -d '{"diagnosis": "...", "fix_plan": "..."}'
        ```
   f. If you CANNOT identify the issue:
      - Update status to `needs_review`:
        ```bash
        curl -s -X PATCH "$API_URL/api/feedback/$ID/status" \
          -H "Authorization: Bearer $API_KEY" \
          -H "Content-Type: application/json" \
          -d '{"status": "needs_review"}'
        ```

### Phase 2: Fix Confirmed Feedbacks

1. Fetch confirmed feedbacks:
   ```bash
   curl -s "$API_URL/api/confirmed" -H "Authorization: Bearer $API_KEY"
   ```
2. If empty → print "No confirmed feedbacks" and exit
3. For each confirmed feedback:
   a. Update status to `fixing`:
      ```bash
      curl -s -X PATCH "$API_URL/api/feedback/$ID/status" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"status": "fixing"}'
      ```
   b. `cd` to the project's `local_path`
   c. Ensure main branch is up to date: `git checkout main && git pull`
   d. Create fix branch: `git checkout -b fix/dabugs-$ID`
   e. Implement the fix described in `fix_plan`
   f. Run the project's tests if a test command exists
   g. If tests pass:
      - `git add` changed files
      - `git commit -m "fix: resolve bug #$ID — $SHORT_DESCRIPTION"`
      - `git push -u origin fix/dabugs-$ID`
      - Create PR: `gh pr create --title "fix: bug #$ID" --body "Resolves DaBugs feedback #$ID\n\n$DIAGNOSIS\n\n$FIX_PLAN"`
      - Capture the PR URL from gh output
      - Update status to `fixed`:
        ```bash
        curl -s -X PATCH "$API_URL/api/feedback/$ID/status" \
          -H "Authorization: Bearer $API_KEY" \
          -H "Content-Type: application/json" \
          -d '{"status": "fixed", "pr_url": "$PR_URL"}'
        ```
   h. If tests fail:
      - `git checkout main` and `git branch -D fix/dabugs-$ID`
      - Update status back to `diagnosed`:
        ```bash
        curl -s -X PATCH "$API_URL/api/feedback/$ID/status" \
          -H "Authorization: Bearer $API_KEY" \
          -H "Content-Type: application/json" \
          -d '{"status": "diagnosed"}'
        ```
      - Print warning: "Fix for bug #$ID failed tests — reverted"

## Rules

- NEVER push to main directly — always create a branch and PR
- One PR per feedback — do not batch multiple fixes
- If you are not confident about the diagnosis, mark as `needs_review`
- Keep fixes minimal — only change what is necessary for the bug
- Do not refactor surrounding code
- Always check for the project in projects.json before processing
- If a project's local_path doesn't exist, skip that feedback
