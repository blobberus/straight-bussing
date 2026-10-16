# RouteKnower on Google Colab (started 2026-10-16)

The owner may run deep learning on the routes on Google Colab. This folder is the starting point.

| File | What it is |
|---|---|
| `routeknower_colab.ipynb` | The notebook: downloads the public data, checks its scoring against the project's, learns on earlier days and tests on later ones (per-stop shift, trees, optional neural network), and gives a verdict. [Open in Colab](https://colab.research.google.com/github/blobberus/straight-bussing/blob/main/experiments/routeknower/colab/routeknower_colab.ipynb) |
| `PLAIN-ENGLISH.md` / `PLAIN-ENGLISH.ipynb` | The reasoning and results for a non-expert. The `.ipynb` is the same text as a Colab notebook. [Open in Colab](https://colab.research.google.com/github/blobberus/straight-bussing/blob/main/experiments/routeknower/colab/PLAIN-ENGLISH.ipynb) |
| `TECHNICAL.md` | The technical reasoning: framing, data and leakage rules, measured results, why trees first, cost, risks, shipping. |

Short version: trees and per-stop corrections now; deep learning later (tier T3, about mid-December, or with GPS
sequence inputs). Results are logged as E23 in `RouteKnower.md`. The data the notebook reads is listed in
`docs/DATA.md` "Using the data on Google Colab".
