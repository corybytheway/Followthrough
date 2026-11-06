# Assistant prefill compatibility

Created by Cory McCabe

Opening an app, prefilling an unsent draft, and submitting a prompt are separate outcomes. Provider checks used harmless synthetic briefs unless explicitly stated below. No completion webhook was invoked during testing. These observations describe the current handoff routes; provider support can change.

| Assistant | Browser | macOS app | iPhone app |
| --- | --- | --- | --- |
| ChatGPT | Complete unsent draft verified | Documented draft link and installed-app launch verified; composer inspection was unavailable | Complete unsent draft verified through the shared foreground launcher on a physical iPhone |
| Claude | Prefill verified on Mac; phone fallback required sign-in | Complete unsent draft verified from the actual Followthrough task button, with no browser fallback | App was absent; ordinary-chat prefill remains unverified |
| Gemini | Signed-in consumer query route left the composer empty; copied-text delivery retained | Missing-app browser fallback verified; native-prefill support unverified | Missing-app Safari fallback verified; native-prefill support unverified |
| Gemini (AI Studio) | Complete unsent draft verified on web and physical iPhone Safari | Browser-only by design | Browser-only by design |
| Grok | Full brief prefilled with Send confirmation; draft was not sent | Installed Safari web app is X-based; app prefill not independently verified | App-link query is preserved; app prefill not independently verified |
| Perplexity | Query link auto-submitted a synthetic test, so the handoff deliberately omits that query and retains copied text | App absent; no unsent-prefill contract verified | App absent; Safari fallback verified |
| Copilot | Legacy query route lost the prompt; current route required Microsoft sign-in | App absent; prefill unverified | App absent; Safari fallback verified |

Grok browser links include `stay_in_browser=true` and the complete short prompt. The app universal link omits that association-file exclusion. Browser prefill does not imply native prefill: copied text remains available as backup, with instructions to paste only if the app opens empty. All oversized briefs retain full copied text, including for otherwise supported draft routes. Perplexity/Copilot use conditional paste guidance rather than claiming native-app incompatibility from an absent-app test. Choosing AI Studio is an explicit separate preference, not a silent redirect from consumer Gemini.

## OS-specific verification

- Shared preference changes originating from each real client propagated to the other two: Mac→web/iPhone, web→Mac/iPhone, and iPhone→Mac/web. Other work-hour/day settings were preserved. The user's later Grok selection was left unchanged during the copy audits.
- The actual Mac task button delivered one marked QA task's full brief to Claude, with exactly one generated completion webhook and no Followthrough login URL. Gemini copied its full brief, Cancel opened nothing, and Open produced one browser fallback. The QA task was archived and its owned draft cleared; it was never completed.
- Physical iPhone shared-launcher checks verified ChatGPT app prefill, AI Studio Safari prefill, and browser fallback for absent Gemini/Claude/Perplexity/Copilot apps. The actual physical task button was not exercised before the phone was withdrawn from testing.
- The actual iOS task button was checked on an isolated iOS27.1 simulator with fictional data: full unsent ChatGPT browser prefill, Gemini copying before launch, Cancel/no navigation, and full clipboard refresh on Open. All seven platform-specific Settings descriptions passed in the actual simulator UI, with the fixture's initial preference restored.
- The branded iOS handoff sheet passed light/dark visual and Cancel checks, with readable text, neutral Cancel, violet/white Open, no clipping at default text size, and no provider launch. The white/violet pair has 5.77:1 contrast. Accessibility-size layout is source-supported but was not exercised in that bounded visual check.
- Clipboard guards restored the original Mac clipboard. No physical-device commands were issued after the phone was withdrawn. The installed Mac20/iPhone21 apps predate the latest wording and sheet changes; those later changes were checked in local builds/simulator only.

Desktop ChatGPT composer inspection and fresh Grok dispatch were restricted by the automation tools. Those checks stopped; alternative surfaces were not used to bypass the restrictions. Native-app prefill for Grok, ordinary-chat Claude on iOS, regular Gemini, Perplexity and Copilot remains a verification gap, not a claimed pass. Web app-install detection is best-effort. Prefill alone does not prove that an assistant mode can execute the task or issue the completion POST.

Primary references: [ChatGPT deep links](https://learn.chatgpt.com/docs/reference/commands#deep-links), [Claude desktop links](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link), [Claude mobile links](https://support.claude.com/en/articles/14898120-open-the-claude-mobile-app-with-a-link), [Gemini Chrome shortcut](https://support.google.com/gemini/answer/14886647?hl=en), [Grok app association](https://grok.com/.well-known/apple-app-site-association), [Perplexity app association](https://www.perplexity.ai/.well-known/apple-app-site-association), [Copilot app association](https://copilot.cloud.microsoft/.well-known/apple-app-site-association), and [Google AI Studio](https://aistudio.google.com/docs/ai-studio-quickstart). UI observations above are direct tests rather than inferred API guarantees.
