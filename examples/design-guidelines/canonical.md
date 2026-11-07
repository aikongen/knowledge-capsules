# Shared design guidelines

Use these rules when designing, changing or reviewing anything a person sees, reads, decides or recovers from. This is the authoritative source for shared product design. Platform guidance determines how these outcomes are presented, without waiving usability, accessibility, consent or truthful status.

## Apply the rules without being asked

Apply this guide to every change that alters what a person sees, reads, decides or recovers from, whether or not the request mentions design. That includes wording, defaults, errors, empty, pending and unknown states, and backend behavior that produces them. Scale the work to the change: a wording fix applies the naming and status-wording rules below and leaves the screen alone, and a change with no effect on a person needs no design work.

Make ordinary design decisions from this guide, the platform guide and the product's recorded decisions. Ask the owner only for missing product intent or authority, with a recommendation. Comparing two or three credible directions, or a longer design conversation with the owner, is for when the owner asks for one or a material visual direction is open; routine work requires neither. An acceptance step that a workflow or product requires still applies. A product's own recorded decisions stay in its guidance and survive a guidance upgrade.

Aim for a product that feels simple, beautiful, premium and calm: one clear purpose per view, a steady rhythm from the product's existing spacing and type scale (tokens on web, system text styles on native), color reserved for meaning, precise copy, and nothing decorative competing with the task. Passing the gates below does not by itself make a screen good; also judge whether it looks considered and quiet, and when it falls short, name the specific change that would improve it. A review finding names the rule or the concrete consequence for the person. A different taste is a suggestion, not a defect.

## Make the product usable before it needs explaining

A first-time person without our vocabulary or professional background should be able to complete an ordinary supported task, understand the result and recover from a mistake without a tutorial or another person's help. Include that outsider perspective in review; familiarity with the product must not excuse confusion. Prior education must not compensate for an unclear interface.

Labels, examples, units and a short explanation beside a consequential choice are part of the design. A tour that teaches where basic actions are hidden is a repair signal. When a task genuinely requires domain judgment, name the specific prerequisite and provide a safe stopping point. Do not turn “expert product” into an exemption for jargon or unexplained controls.

Simplicity means less effort to reach a useful, understood result. Count the searching, reading, decisions, memory and recovery the journey requires, not just its controls or clicks. A sparse screen that hides what the person needs fails this rule.

Before choosing a layout, identify the actions and outcomes the task requires. After simplifying, check that each remains reachable. Collapsing several required choices into one fixed value removes capability rather than simplifying it. Use supported choices; do not invent extra presets merely to fill a screen. Mark missing domain constraints instead of silently narrowing capability.

## Decide what the product can responsibly decide

- **Start with a useful default.** Infer information already available and avoid asking again. Expose a setting when a real task needs a different outcome, not because an implementation offers a parameter.
- **Keep meaningful control.** Do not infer permission to spend, share, delete or affect other people. Explain the scope and consequence before commitment; use the actual action as the button label. Never preselect the destructive choice in a confirmation.
- **Show what matters now.** Prioritize the person's goal, current state and next useful action. Keep internal workers, protocols and configuration structure out of the ordinary flow unless they help a real decision.
- **Make changes understandable.** Show effective behavior, including inherited values and relevant dependencies. Preserve a discoverable route to necessary adjustments and details.
- **Keep the experience steady.** Use familiar platform patterns, consistent names, readable hierarchy and stable layout. Reserve space for loading content so controls do not unexpectedly jump under the pointer or lose focus. Keep necessary reflow predictable.

## Apply the rules in context

| Situation                         | Do                                                                                                                                                                                                                                                                  | Don't                                                                                                                                      | When the choice changes                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Infrequently changed settings     | Lead with current behavior. Group related choices by an understandable outcome, such as “When you hear from us.” Show “Urgent updates immediately; other updates daily at 09:00, Copenhagen” with an adjacent change action. Reveal the relevant controls together. | Start with an undifferentiated wall of toggles, group by backend modules, or hide an important exception behind an attractive summary.     | Keep frequently adjusted controls directly available. A summary that takes more effort than a small familiar control is not an improvement. |
| First use or connecting a service | Get to the first useful result with known values filled in. Explain the permission and effect at the point of connection. Ask only for information or authority the product lacks.                                                                                  | Require a tour, infrastructure choices or a full preferences form before ordinary use. Treat a convenient default as permission to share.  | An unavoidable prerequisite needs a clear reason and recovery path. Do not pretend connection succeeded while permission is missing.        |
| Work overview                     | Show what is running, what needs attention and the useful next action. Group related activity around the person's work; make deeper evidence reachable.                                                                                                             | Fill every card, repeat the same status under every project, or expose internal agents merely because they exist.                          | Keep distinct concepts distinct: planned work and actual execution may need separate views even when one view looks simpler.                |
| Irreversible or shared change     | Before enabling automatic deletion, say what existing data it affects, who is affected and whether recovery exists. Show a preview when the effect is knowable. Keep the safe state until informed commitment.                                                      | Hide destructive effects in “Advanced,” choose retention obligations on the person's behalf, or show an Undo that cannot restore the data. | Prefer real undo for reversible mistakes. Use confirmation for consequential irreversible effects, not every routine action.                |
| Failure, delay or uncertainty     | Preserve entered work, say what happened and offer the next useful action. Distinguish pending, confirmed, failed and unknown. Make retry safe and show how to stop when stopping is supported.                                                                     | Replace uncertainty with success, reset the form after a failure, or show a generic error code as the only explanation.                    | A product cannot always recover automatically. Name what remains safe and what information or authority is needed to continue.              |

The settings example reflects the chosen direction: summary first, with meaningfully named groups. It is not a rule that every page must collapse its controls. Group names and summaries must explain the actual effect, not introduce another vocabulary to learn. Put task-specific options beside the work they affect so people need not leave their task for a global settings page.

## Use motion to explain change

Give each animation a user-facing purpose: show a relationship, preserve orientation, acknowledge input or communicate real progress. If removing it loses no useful meaning or feedback, omit it from the ordinary task flow.

- **Connect cause and effect.** A settings group can reveal its controls in place so the relationship stays clear. Keep its trigger in place and expose the controls in the normal reading and tab order. Do not steal focus or leave it in collapsed content. Retain a visible expanded state when motion ends.
- **Keep work responsive.** Use the platform's motion behavior and existing tokens. Do not make people wait for an animation before acting. Handle interruption, rapid reversal and navigation without stale results or blocked input.
- **Report actual state.** A press response acknowledges input; it does not prove saving. Show success only after confirmation. Use determinate progress only when progress is knowable; otherwise communicate ongoing work without a fabricated estimate. Routine saves can use quiet in-context feedback. Keep cancellation available where supported.
- **Respect motion preferences.** Remove decorative movement under reduced motion. Preserve necessary meaning through immediate state changes, text, highlighting or a less disruptive transition. No essential information may depend only on motion. Provide pause, stop or hide controls for nonessential continuous motion and automatic updates alongside other content. Avoid flashing effects; reduced motion is not a substitute for flash safety.
- **Verify over time.** Observe the transition, repeated interaction and reduced-motion behavior on the actual artifact. Check focus, layout movement and final state. A static screenshot cannot establish motion quality or correctness.

Do not add recurring pulses, large zooms, bouncing controls, staged delays or animated decoration merely to make the product feel polished. Do not copy one duration or spring across every platform. Platform defaults are the starting point; an exception needs a specific benefit and observed behavior.

## Preserve meaning and access

Use one name for a product, feature, action or item across targets. Success, warning and danger keep their meaning even when each platform draws them differently. Never rely on color, position, sound or motion alone to communicate essential state.

Provide accessible names, keyboard and assistive-technology access, visible focus, readable text and responsive layouts. Honor reduced motion, increased contrast and reduced transparency where offered. Reachable loading, empty, error and disabled states belong to the journey, not a later polish pass. A disabled action needs an understandable reason or a route to resolve it when that is possible.

A failed or missing response does not prove that an operation had no effect. Say “Nothing changed” only when the underlying state establishes that fact. When the result is uncertain, preserve the work, show uncertainty and reconcile the existing attempt before offering a retry that could duplicate effects. Distinguish canceling an operation from closing its view: after submission, offer Cancel only if the operation can actually be stopped, and claim cancellation only when confirmed.

Use the target's existing components and platform conventions. Web component fidelity remains a component requirement; it does not establish that a page uses the right controls or information. Native apps use native components, fonts, colors, materials and shortcuts. Shared rules do not prescribe identical pixels, a universal column layout or one typeface across targets. Product-specific brand choices must not undermine these outcomes.

## Judge a journey from evidence

AI may accept or reject a design against these rules. A human study is not a prerequisite for an AI gate verdict: state what the AI actually observed and its limits. Do not claim that a tasteful screenshot or successful navigation proves human usability. Representative human usability remains unknown until observed with people. Record that limitation separately; it does not block acceptance against the AI gates below.

Use the smallest trial that can expose the decision. For a layout question, reuse an existing screen or a minimal preview. For an interaction question, use existing components and only the behavior needed to test it. Compare two or three credible directions with identical content, starting state and goal when the owner must choose a material visual direction. Do not build a backend or a full application to settle that choice.

For a new or materially changed journey, use the following trial. For a small change, inspect and exercise the affected gates; do not repeat unaffected evidence. The unfamiliar scenario and good/flawed calibration are needed when introducing or changing a reusable rule or judging method, not for every routine screen edit.

1. Give a fresh actor an ordinary goal and the rendered interface, without the implementation, design rationale or control names that reveal the solution. Choose a task that is meaningful without specialist vocabulary.
2. Before a consequential action, have the actor predict its effect from visible evidence. Record where the interface makes them guess; outside knowledge must not fill the gap.
3. Observe the result, including the effective saved state when persistence matters. A success message alone is insufficient. Exercise the relevant mistake, failed operation or safe stopping path and applicable accessible input.
4. Have an independent reviewer inspect the observations against the gates below. Separate observations from the actor's interpretation. Inspect missing evidence before asking the owner; escalate only unresolved intent or authority.
5. Check the proposed rule on an unfamiliar scenario. Calibrate the review with a credible good case and a targeted flawed variant, such as a hidden deletion consequence. Agreement between models is not independent proof of usability.

| Gate                          | Evidence needed for PASS                                                                                                                          | Example of FAIL                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Find and start                | The actor identifies and reaches a useful first action without coaching, with readable content and accessible names.                              | The task requires knowing an internal term or completing a tour to find the action.       |
| Understand and choose         | Visible defaults and grouped summaries accurately explain behavior; required controls remain discoverable.                                        | A summary hides an exception, or simplifying removes a control required by the task.      |
| Commit knowingly              | The actor predicts the material effect and scope from information shown before commitment.                                                        | Shared data is deleted by an innocuous toggle without disclosing existing-data impact.    |
| Know the result               | Observed state supports the displayed outcome, including delay, failure and uncertainty.                                                          | “Saved” appears before confirmation or persists after the save fails.                     |
| Recover and remain in control | The relevant recovery or safe stop works with keyboard and applicable assistive input; focus, contrast and motion preferences do not obstruct it. | Retry loses work, rapid interaction applies a stale choice, or keyboard focus disappears. |

Record PASS, FAIL or UNKNOWN for each applicable gate, with the task, candidate, observation and limitation. A known violation is FAIL, including a specification that visibly omits a required action; missing runtime evidence does not erase that finding. Missing observation is UNKNOWN, not a pass or a design defect by itself. Explain any gate that is not applicable. Resolve essential UNKNOWN evidence before acceptance; do not average away a failed gate with a score.

Static-only work may establish layout evidence while interaction and motion remain UNKNOWN. A guidance-only smoke test may establish discovery and an agent's proposed decisions; it cannot establish rendered usability. Do not present either as a human usability study.
