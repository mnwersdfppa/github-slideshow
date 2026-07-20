---
layout: slide
title: "Rate limit recovery playbook"
---

## 자동화봇 응답 지연 해결

If every model says it is temporarily rate-limited, pause retries and let the approval settle.

1. Reply with the exact `/approve plugin:<id> allow-once` command once.
2. Wait a few minutes before sending another prompt.
3. If the warning repeats, switch to a lighter model or retry after the rate-limit window resets.

Use the left arrow to go back!
