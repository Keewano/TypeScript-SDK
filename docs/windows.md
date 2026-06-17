[Back to overview](README.md)

# Windows, Popups, and Buttons

These events describe how players move through your UI - the buttons they tap and the
in-screen windows they open and close.

## Button clicks

Taps on `Pressable` components are captured automatically with the button's
accessibility label or text. You normally do not write any code for this.

For buttons the automatic capture cannot see - custom gesture handlers, third-party
UI kits - report the click yourself:

```typescript
Keewano.reportButtonClick('Play');
```

You can also opt out of automatic capture entirely (see [Configuration](configuration.md#disablebuttontracking))
and report every click manually instead.

> [!TIP]
> For a one-off custom button you can use the `KeewanoPressable` component, a drop-in
> replacement for `Pressable` that always reports - handy inside UI stacks the global
> patch does not reach.

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
> Windows are for in-screen overlays. Full-screen route changes are **scenes** - those
> are reported automatically by the navigation hook, see [Automatic Tracking](automatic-tracking.md#screen-tracking).

---

Related: [Automatic Tracking](automatic-tracking.md) | [Tutorial Tracking](onboarding.md)
