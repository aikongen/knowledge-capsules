# Designing for macOS

Apply these rules when you design, build or review a native macOS app's interface in SwiftUI. Apple's Human Interface Guidelines are the authority: where they disagree with these rules, follow Apple, because this text can lag behind the platform. A product's own recorded design decisions win over these rules, because they record a choice made for that product.

## Start from stock SwiftUI

- Use the system's own scenes, containers and controls first, with their default styles: `NavigationSplitView`, `List`, `Table`, `Form`, `.toolbar`, `Button`, `Toggle`, `Picker`, `Menu`, `TextField`. They bring the platform's layout, focus, accessibility and appearance with them.
- Change a stock control's style only for a reason Apple supports, such as `.buttonStyle(.borderedProminent)` for the one primary action in a view, because a redrawn control loses what the stock one brings.
- Use AppKit where a concrete platform need calls for it, and keep that code local, so the rest of the app stays stock SwiftUI.
- Do not add a package or framework to get a look, because the platform already ships it.
- Check each API against the app's minimum macOS version, because a call that compiles on the newest SDK can be missing on an older system.

## Windows

- Use `WindowGroup` when a person can usefully open more than one window, and `Window` for a single, unique window, because the scene type decides whether the app offers a new window at all. Add a `MenuBarExtra` only when the app's job lives in the menu bar.
- Give each window a title that names its content with `.navigationTitle`, and use `.navigationSubtitle` for secondary context, because the title is how a person tells windows apart.
- Where restoring a window is part of the journey, keep its small values, such as a selection or a tab, in `@SceneStorage`, which holds only those. Do not imply persistence for data that resets at launch, because a restored view of lost data misleads.
- Let the system handle window controls, tabs and full screen. Do not hide the title bar or the window buttons to save space, because a person moves, resizes and closes every Mac window the same way.

## Navigation

- For an app that manages items, start with `NavigationSplitView`: a sidebar `List(selection:)` and a detail view for the selection, because Mac users know this layout from the system's apps. Add a middle content column only when the sidebar holds categories and the items need their own list.
- Use the sidebar for places and collections, not for actions. Keep it collapsible and let the system draw its material, because a person expects to hide it and to see it match other apps.
- Use `Table` when items have several comparable attributes, because a table lets a person sort and scan by column.
- Let selection drive the detail view and the commands that act on it, so a command acts on what the person sees selected. Support multiple selection where a command makes sense for more than one item.
- Use `.inspector` for secondary details of the selection rather than a custom side panel, because the system panel already resizes, collapses and appears in the View menu.

## Toolbars

- Put the frequent commands for the current window in `.toolbar`, with `ToolbarItem` placements such as `.primaryAction` and `.navigation`, so the system arranges them.
- Give every toolbar item a `Label` with a title and an SF Symbol. The title is what VoiceOver reads and what the toolbar shows when a person chooses to see text.
- Put search in the toolbar with `.searchable`, because that is where people look for it.

## Filters

- For a filter the person changes often within the current collection, start with a labeled system picker in the toolbar and offer the same choices in the View menu, because the menu is where a person looks for every choice.
- Keep a temporary filter in memory, use window state only when restoring it is part of the journey, and use settings only for an app-wide preference, because a filter that outlives its moment surprises the next session.
- A filter must not change the items or register an undo operation, because it changes the view, not the data. When it hides the selection, keep the selection identity but disable commands for content that is not visible.
- Explain a filter with no matches with a `ContentUnavailableView` and a reset action, so the person sees why the list is empty and how to undo it.

## Menu bar and commands

- Expose app commands through the menu bar, including those also in toolbars or context menus, because a toolbar can be hidden and a person who cannot find a command looks there.
- Keep the standard menus (the app menu, File, Edit, View, Window and Help) and their standard items, because people find commands there by habit. Add commands with `.commands`, `CommandMenu` and `CommandGroup`, and include `SidebarCommands` when the app has a sidebar.
- Disable a command that cannot act on the current selection rather than hiding it, so the menu stays predictable. Use `focusedSceneValue` to give a command the current window's selection.
- Put the most relevant commands for what was clicked in its context menu. A context menu repeats menu bar commands; it never holds the only copy, because a person cannot find what only a right-click shows.

## Keyboard and focus

- Make every action reachable from the keyboard, because some people never use a pointer. Add `.keyboardShortcut` for frequent commands and use the standard shortcuts for standard actions. Do not redefine a shortcut the system or the standard menus already use, because a person's habits break silently.
- In a dialog, mark the confirming button with `.keyboardShortcut(.defaultAction)` and the dismissing button with `.cancelAction`, unless the confirming action is destructive, because a habitual Return would then destroy.
- Let the system draw the focus ring. Manage focus with `@FocusState` and `.defaultFocus`, make custom interactive views `.focusable()`, and never hide the focus ring, because a keyboard user then loses their place.

## Type, color, materials and glass

- Set type with the system font through text styles: `.font(.body)`, `.headline`, `.title2`. Do not set fixed point sizes or bundle an interface typeface, because text styles carry the system's sizes, weights and hierarchy and stay correct when Apple changes them.
- Use semantic color: `.foregroundStyle(.primary)`, `.secondary` and `.tertiary` for text hierarchy, the app's accent color through `.tint` for interactive emphasis, and system colors such as `.red` and `.green` for meaning. Do not set fixed RGB values for interface color, because system colors adapt to light, dark and higher contrast. Check contrast in the actual composition, because a named color alone does not prove an accessible status.
- Draw icons with SF Symbols through `Image(systemName:)` or `Label`, because they match the system font's weight and size.
- Take materials and Liquid Glass from the standard containers. Do not put glass or a material behind content. Use a custom `.glassEffect` only for a small floating control layer above content, rarely and with a stated reason, because glass behind content costs legibility.
- Never carry meaning in color alone. Pair a status color with a symbol or a word, because some people cannot tell the colors apart.

## Layout and resizing

- Make windows resizable and let content reflow, because people size windows to their screen. Set the minimum size from what the content needs at its smallest usable layout, with `.frame(minWidth:minHeight:)` or `.navigationSplitViewColumnWidth`, not from another app's number.
- Give the main window a sensible first size with `.defaultSize` and let the system remember the size a person chooses, because a window should reopen as it was left.
- Use the system's spacing by default: stack spacing, `Form` and `List` insets, and `.padding()` without a value. Add a fixed value only when a layout needs one, and say why in the code, so the next reader does not remove it as noise.
- Try the narrowest window, a very wide window, full screen and a collapsed sidebar, because clipping and stretching show only at the extremes.

## Feedback, errors and destructive actions

- Show the result of an action where it happened: the item or the status changes. Do not add a toast for an outcome the person can already see, because it repeats what they saw and covers content.
- Prefer undo to a confirmation: register changes with the window's `UndoManager` so Edit > Undo reverses them, because undo lets a person act quickly and still recover.
- Ask for confirmation only for an action that cannot be undone and loses data. Use `.confirmationDialog` or `.alert`, name the action on the button ("Delete 3 Items", not "OK"), give the button `role: .destructive`, and do not make it the default button, because a habitual Return would then lose the data.
- Mark destructive buttons and menu items with `role: .destructive`, so the system styles and announces them as destructive. Let the Delete key reach them through `.onDeleteCommand`, because that is the key a Mac user presses.
- Show an error beside what failed: say what happened and what the person can do, and offer the recovery action. Use an alert only when the person must decide before continuing, because an alert blocks the window until it is answered.

## States

Handle the states the journey can reach, with stock views, because a reachable state with nothing deliberate on screen leaves the person guessing. Do not invent loading or network failures for local data, because nobody will see them.

- **Loading**: `ProgressView`, determinate when progress is known. Keep stale content visible while refreshing it.
- **Empty**: `ContentUnavailableView`, saying what will appear here and, when there is one, the action that adds it.
- **No selection**: `ContentUnavailableView` in the detail column.
- **No results**: `ContentUnavailableView.search` for a search with no match.
- **Error**: the message and a retry or recovery action in place of the content.
- **Disabled**: `.disabled`, so the control looks and reads as unavailable. Say why nearby when it is not obvious.
- **Partial**: show what loaded, and mark what did not with a symbol and text, not color alone.

## Settings

- Open settings from the app menu's Settings item with Command-Comma, because that is where Mac users look. Where they appear is the product's recorded decision; read it before adding a `Settings` scene, because products differ on this.
- Build settings from a `Form`, so labels and controls align the system's way, and use a `TabView` only when there are several groups.
- Apply a change to an app preference as soon as it is made, because macOS settings have no Save button and a person expects the change to hold at once.
- Keep settings to what people change, because a choice the app can make well by itself is not a setting.

## Accessibility

- Give every control a name, role and value, because VoiceOver reads them aloud. Stock controls do this; an icon-only control keeps its title in a `Label` with `.labelStyle(.iconOnly)`, or gets an `.accessibilityLabel`. Add `.help` for the pointer tooltip of an icon-only control.
- Read `colorSchemeContrast` only when a custom view must adapt to Increase Contrast, because system colors already adapt.
- Keep animation short and meaningful, and replace movement with a fade or no animation when `accessibilityReduceMotion` is on, because movement can make some people ill.
- A custom translucent view reads `accessibilityReduceTransparency` and becomes opaque, as system materials do, because some people cannot read text over a blurred background.

## Reporting what was checked

- Check the app with VoiceOver, Full Keyboard Access (Tab reaches every control in a sensible order), Increase Contrast, Reduce Motion, Reduce Transparency and Xcode's Accessibility Inspector, in light and dark appearance, because each finds failures the others miss.
- Report resizing and these accessibility checks as `NOT_RUN` until the app has run on a Mac, because a successful build or a source read cannot show them.
