[Back to overview](README.md)

# Tutorial Tracking

Onboarding milestones tell Keewano how far new players get through your tutorial and
first-time experience - one of the most important signals for retention.

## Report a milestone

Call this each time the player reaches a named step.

```typescript
Keewano.reportOnboardingMilestone('TutorialStart');
Keewano.reportOnboardingMilestone('FirstMatchWon');
Keewano.reportOnboardingMilestone('TutorialComplete');
```

`name` is your own label for the step. Use stable, descriptive names so you can build
a clean funnel in the dashboard.

> [!TIP]
> Reporting the same milestone name more than once is fine. The SDK adds a counter
> suffix automatically - `"TutorialStart"`, `"TutorialStart (#2)"`, `"TutorialStart (#3)"` -
> so the backend can tell repeats apart without you tracking state yourself.

> [!NOTE]
> The dedup counter resets when the SDK restarts (a fresh `init`). It is meant for
> distinguishing repeats within a session, not for lifetime counting.

---

Related: [Windows and Buttons](windows.md) | [Marketing Campaign](install-campaign.md)
