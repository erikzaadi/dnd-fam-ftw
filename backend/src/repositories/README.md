# Repository Boundaries

Repositories own persistence for one data area and should stay close to SQL row shapes, table names, and row-to-domain mapping.

`StateService` remains the stable compatibility facade for routes, scripts, and services. Keep cross-domain validation or side-effect orchestration outside repositories, in a service layer such as `StateService` or a focused orchestration service.

Avoid repository-to-repository imports unless there is a clear ownership reason. Prefer passing validated IDs into lower-level repository methods.
