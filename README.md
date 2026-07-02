# Daily Log

A personal food and IBS symptom tracker, built as an installable web app (PWA).

- **Meals** — quick free-text logging with autocomplete from your own history and optional trigger tags
- **Daily check-in** — wellbeing, stress, sleep, exercise minutes
- **Symptoms** — bloating, gas, urgency (0–5)
- **Stools** — count and Bristol scale type, with a built-in reference chart
- **Trends** — 7/30/90-day charts for every measure

All data stays on the device in IndexedDB — there is no server and nothing is uploaded. Use Settings → Export backup for a JSON copy of your data.

Daily Log is a personal diary, not medical advice.

## Development

```
python3 serve.py 8123
```

Then open http://localhost:8123. No build step, no dependencies.
