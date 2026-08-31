# Module Design (green fixture)

Clean tree: the allowed-import graph below is acyclic, so
validate-circular-deps must pass it with zero gaps.

## Dependency Rules

| Module | May Import From        |
| ------ | ---------------------- |
| shared | (nothing — foundation) |
| core   | shared                 |
| app    | shared, core           |
