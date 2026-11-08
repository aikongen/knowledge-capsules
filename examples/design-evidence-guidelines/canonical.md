# Judging a design from evidence

Apply these rules when you judge, review or accept a screen, flow or journey, including when the request only asks whether it is done or good enough.

An agent may accept or reject a design against the design rules it was given. A human study is not a prerequisite for an AI gate verdict: state what the AI actually observed and its limits. Do not claim that a tasteful screenshot or successful navigation proves human usability. Representative human usability remains unknown until observed with people. Record that limitation separately; it does not block acceptance against the AI gates below.

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
