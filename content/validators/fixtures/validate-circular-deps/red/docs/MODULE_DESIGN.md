# Module Design (red fixture)

Planted defect: `alpha` and `beta` import each other, so the allowed-import
graph below contains the cycle alpha -> beta -> alpha. validate-circular-deps
must report it as a gap.

## Dependency Rules

| Module | May Import From |
| ------ | --------------- |
| alpha  | beta            |
| beta   | alpha           |
