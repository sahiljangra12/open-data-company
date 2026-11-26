# Our own model

The site's own trained model, built in pieces. Everything here runs for free on GitHub's machines, and every
training example is made from the datasets already on the site, each with its source and licence. Nothing is scraped.

## Piece 1: the matcher (trained)

Reads a question in everyday words and finds the variable it is asking for, among every numeric variable on the site.
It is trained on the sustainability and policy datasets: climate, energy, the environment, food, health, education,
poverty, governance, democracy, regulation, and climate and environment policy.

| File | What it does |
|---|---|
| `make_examples.py` | Builds the training questions from the site's list of datasets, plus a held-out set made with other wordings. |
| `natural_questions.tsv` | About a hundred questions written by hand, with the right variable for each. Never trained on: this is the honest test. |
| `train.py` | Trains a small open text model (all-MiniLM-L6-v2, 22 million parameters, Apache 2.0) and scores keyword search, the untrained model and the trained one on the same questions. |
| `REPORT.md`, `results.json` | The scores from the latest run that was kept. |

Train it: Actions → **Train the matcher** → Run workflow (set *publish* to `yes` to keep the report and release the model).
The trained model is attached to the `matcher-latest` release.

To add a topic, add its dataset ids to `FOCUS` in `make_examples.py`, add a few hand-written questions for it, and run the workflow.

## Piece 2: the answering model (next)

A small open language model, fine-tuned to turn a question into the right read of the data and to write the answer
only from the figures that come back. That needs a graphics card, which GitHub's free machines do not have, so it
will be trained in a free notebook and then run on GitHub by the Data Agent.
