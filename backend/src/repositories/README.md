# Repository Boundaries

Repositories own persistence for one data area and should stay close to SQL row shapes, table names, and row-to-domain mapping.

Routes, scripts and services call repositories directly; there is no facade. Keep cross-domain validation or side-effect orchestration outside repositories, in a focused module such as realm access (`realms/access.ts`), the adventure archive (`archive/`) or paid-work admission (`services/paidWorkAdmission.ts`).

Avoid repository-to-repository imports unless there is a clear ownership reason. Prefer passing validated IDs into lower-level repository methods.
