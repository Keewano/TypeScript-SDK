[Back to overview](README.md)

# Marketing Campaign

Attribution events let Keewano connect installs to the campaigns that drove them, and
record the language the player is using.

## Report the install campaign

Once you know which campaign brought the player in (from your attribution provider,
a deep link, or a referrer), report it.

```typescript
Keewano.reportInstallCampaign('summer_sale_2026');
```

`campaign` is your own campaign label.

> [!TIP]
> Report this as early as you can - ideally on the first launch, right after `init`,
> as soon as attribution resolves - so the campaign is attached to the player's whole
> history.

## Report the game language

Record the language the player has the game set to. This is the in-game language,
which can differ from the device language the SDK captures automatically.

```typescript
Keewano.reportGameLanguage('en');
```

> [!NOTE]
> Call `reportGameLanguage` again whenever the player changes the language in your
> settings, so the backend always has the current value.

---

Related: [Tutorial Tracking](onboarding.md) | [Configuration](configuration.md)
