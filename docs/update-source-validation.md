# Default update repository validation

Date: 2026-10-02 (Asia/Taipei). The user requested the project's repository as the default update source while local Host/Origin policy design was still in progress.

The git origin resolves to `github.com/ethan-devlab/codex-token-dashboard`. Runtime configuration and settings responses now use `ethan-devlab/codex-token-dashboard` when UPDATE_REPOSITORY is absent. An explicit blank value still disables checks; a configured owner/repo still takes precedence. Process environment overrides remain ignored for this field. The .env example and README describe the same default. The user's existing .env was not edited and the running 3333 process was not restarted for this change.

Update checks remain user-triggered. This default does not add automatic checks, downloads, installation, GitHub credentials or repository writes. The choice to change the local update endpoint from GET to same-origin POST is a separate pending design decision. The default-source change does not implement that method change.

Validation:

- Three selected server-service cases passed: update checker, runtime configuration and settings persistence. They cover absent/default, explicit blank, custom source, ignored environment overrides and consistent settings payloads.
- The copied-service HTTP fixture passed seven groups, including a real settings API response with the default repository when the fixture's .env has no UPDATE_REPOSITORY key. Its source responses and Session data are synthetic.
- Changed modules passed syntax checks; git diff --check passed.
- An unauthenticated read-only GitHub repository request returned 200 and private=false. The latest-release endpoint returned 200 with stable `v2.0.0` at the time of the check. The checked-in app version is 2.1.0, so that response does not identify a newer release. No release was created or modified.

Public releases can be queried without authentication. See [GitHub release API documentation](https://docs.github.com/en/rest/releases/releases#get-the-latest-release). This is a bounded source/default validation, not a production restart or a guarantee about future Release availability. No browser layout changed, so desktop visual QA was not repeated for this change.
