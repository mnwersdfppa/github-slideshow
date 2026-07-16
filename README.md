# Your GitHub Learning Lab Repository for Introducing GitHub

Welcome to **your** repository for your GitHub Learning Lab course. This repository will be used during the different activities that I will be guiding you through. See a word you don't understand? We've included an emoji 📖 next to some key terms. Click on it to see its definition.

Oh! I haven't introduced myself...

I'm the GitHub Learning Lab bot and I'm here to help guide you in your journey to learn and master the various topics covered in this course. I will be using Issue and Pull Request comments to communicate with you. In fact, I already added an issue for you to check out.

![issue tab](https://lab.github.com/public/images/issue_tab.png)

I'll meet you over there, can't wait to get started!

## OpenClaw OAuth guardian

`script/openclaw-oauth-guardian` is a read-only operational check for the
canonical OpenAI OAuth identity: provider `openai`, profile `openai:default`.
It lets OpenClaw own OAuth refreshes and only alerts an operator when that
profile is absent or OpenClaw reports a permanent refresh rejection. It never
starts a login, refreshes a token, probes a model or channel, or changes model
selection.

The guardian reads `openclaw models auth list --provider openai --json` and
`openclaw models status --check --json`, and records the cached
`openclaw health --json` snapshot for diagnosis. Alerts are one per incident
kind for 24 hours by default. Set `OPENCLAW_ALERT_COMMAND` to a command that
accepts the alert text as its first argument; otherwise the alert is written to
standard error. `XDG_STATE_HOME`, `OPENCLAW_PROVIDER_ID`,
`OPENCLAW_PROFILE_ID`, and `OPENCLAW_ALERT_COOLDOWN_SECONDS` are configurable.

Run the regression check with:

```sh
test/openclaw-oauth-guardian-test.sh
```

This course is using the :sparkles: open source project [reveal.js](https://github.com/hakimel/reveal.js/). In some cases we’ve made changes to the history so it would behave during class, so head to the original project repo to learn more about the cool people behind this project.
