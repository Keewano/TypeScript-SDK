[Back to overview](README.md)

# Windows, Popups, and Buttons

These events describe how players move through your UI - the buttons they tap and the
in-screen windows they open and close.

## Button clicks

Taps on `Pressable`, `TouchableOpacity`, `TouchableHighlight` and
`TouchableWithoutFeedback` are captured automatically. You normally do not write any
code for this.

The reported name is the first of these that is set: `testID`, `accessibilityLabel`,
or the button's text when its child is a plain string. Nested elements are not
inspected, and a button with none of these reports as `Anonymous`.

On the web SDK the equivalent is a delegated click listener with its own qualifying
rules and name ladder - see
[Automatic Tracking](automatic-tracking.md#clicks-on-the-web).

For buttons the automatic capture cannot see - custom gesture handlers, third-party
UI kits - report the click yourself:

```typescript
Keewano.reportButtonClick('Play');
```

You can also opt out of automatic capture entirely (see [Configuration](configuration.md#disablebuttontracking))
and report every click manually instead.

> [!TIP]
> For a one-off custom button you can use the `KeewanoPressable` component - pass it
> your `Pressable` via the `pressable` prop and it reports on every press, even when
> `disableButtonTracking` is on. It reports by wrapping your `onPress` handler, so a
> `KeewanoPressable` without an `onPress` prop is left untouched and reports nothing.
> Pass `buttonName` to name the click explicitly instead of relying on the ladder
> above.

## Windows and popups

For in-screen windows - shops, settings panels, modals - report when they open and
close:

```typescript
Keewano.reportWindowOpen('Shop');
// ... player browses ...
Keewano.reportWindowClose('Shop');
```

`name` is your own label for the window.

> [!NOTE]
> On the device SDKs, windows are for in-screen overlays; full-screen route changes are
> **scenes**, reported automatically by the navigation hook - see
> [Automatic Tracking](automatic-tracking.md#screen-tracking). The web SDK has no
> scenes: its navigation tracker reports page navigations as window open / close, so
> your manual `reportWindowOpen` / `reportWindowClose` calls for overlays sit alongside
> them.

---

Related: [Automatic Tracking](automatic-tracking.md) | [Tutorial Tracking](onboarding.md)
