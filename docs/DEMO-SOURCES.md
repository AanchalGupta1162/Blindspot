# Demo story sources — checked 2026-11-05

Presentation is a three-slide, member-only web slideshow in `/presentation`, not a PowerPoint file. Tab order: Presentation → Architecture → Room → Lab → Runs → Results → Team.

## Incidents

- [Jadavpur source](https://www.telegraphindia.com/my-kolkata/news/fire-at-jadavpur-university-lab-melts-tools-worth-crores/cid/1857500). Slide 1 contains a short attributed summary.
- Bangalore Bioinnovation Centre: [PTI / Economic Times, 15 January 2025](https://economictimes.indiatimes.com/news/bengaluru-news/fire-at-bangalore-bioinnovation-centre-damages-properties-worth-rs-110-cr-minister-kharge/articleshow/117249955.cms). Minister’s office reports preliminary startup losses ₹80–110 crore and centre property loss about ₹42 crore, giving a combined ₹122–152 crore range. Flammable-solvent management was cited; this is a chemical-lab incident outside Blindspot’s fault model. Do not call it an electrical fire or claim prevention.
- [Delhi source](https://www.hindustantimes.com/delhi-news/fire-incident-reported-at-delhi-college-firefighters-at-the-spot/story-kQTMGmfTT8U9Zwe1EjF4TK.html). Not included in the condensed presentation.

## Global infrastructure context

- [IEA, Key Questions on Energy and AI, April 2026, executive summary](https://www.iea.org/reports/key-questions-on-energy-and-ai/executive-summary): 485 TWh global data-centre electricity consumption in 2025; central projection 950 TWh by 2030. The latter is a projection. These replace older 415/945 figures when presenting the newer outlook.
- [Uptime Institute Global Data Center Survey 2024, p.19](https://datacenter.uptimeinstitute.com/rs/711-RIA-145/images/2024.GlobalDataCenterSurvey.Report.pdf?version=0): 54% of responding operators with an impactful outage reported their most recent significant outage cost over US$100,000; n=91 for the cost question. This is a survey subset, not the percentage of all data centres experiencing expensive outages. Costs include recovery, opportunity and reputation costs.

No global lab-fire incidence statistic is claimed. These facts illustrate research loss and infrastructure scale; they establish neither product-market demand nor that Blindspot could have prevented specific incidents.

## Muse evidence

Results derive from the 20 actual eval-v2 Spark recordings: 15/18 early detections, 12/18 expected breaches avoided, zero alerts on two controls; 284 turns, 1,578,299 input tokens, 105,946 output tokens including 43,248 reasoning tokens; $2.423. Tool-call counts are computed from the event logs. Auto-simulated approvals and reused evaluation seeds are disclosed. No claim of unique necessity, real-world safety or proven superiority over all alternatives is made.

## Local incident photographs

The three-slide deck contains no hyperlinks; source credits are plain text. Photos were retrieved from the cited news pages and visually checked on 2026-11-05. They depict incident aftermath, not generated fire imagery. No open reuse licence is asserted.

- `public/demo/jadavpur-lab.jpg`: The Telegraph, 25 March 2022, original article image: https://assets.telegraphindia.com/telegraph/2022/Mar/1648163751_25metlab2_4c.jpg . Shows the damaged Jadavpur lab. The concise on-slide incident summary stays under 25 words derived from this source.
- `public/demo/bangalore-bioinnovation.jpg`: image published with the PTI / Economic Times report, 15 January 2025: https://img.etimg.com/photo/117249984.cms . Shows damage inside the centre. Credit names the publication; no individual photographer was established from retrieved metadata.

Deck sequence: problem with incident photographs → sparse-sensor / digital-twin idea with room diagram → inspectable agent/tool/gate/human workflow and disclosed simulation results. Architecture is an illustrative animated walkthrough, not live telemetry. Pause, stage selection, keyboard access and reduced-motion support are provided.
