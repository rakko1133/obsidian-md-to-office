# Mermaid: flowchart

図の種類: `flowchart TD`

```mermaid
flowchart TD
    A[Start] --> B{Is it OK?}
    B -->|Yes| C[Convert]
    B -->|No| D[Skip]
    C --> E((End))
    D --> E
```
