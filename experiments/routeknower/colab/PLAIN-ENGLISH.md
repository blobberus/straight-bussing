# RouteKnower on Colab, in plain English

[Open this page in Colab](https://colab.research.google.com/github/blobberus/straight-bussing/blob/main/experiments/routeknower/colab/PLAIN-ENGLISH.ipynb)
· [Open the notebook in Colab](https://colab.research.google.com/github/blobberus/straight-bussing/blob/main/experiments/routeknower/colab/routeknower_colab.ipynb)

## The question
Passio's app tells riders when the next bus will come. Straight Bussing records, every minute, what Passio said and
when the bus really came. The question is: **can a computer model learn to correct Passio's times**, so they are
right more often, and **almost never too late**? A time shown too late is a missed bus.

## The short answer: not deep learning yet
"Deep learning" means a neural network: a model with many adjustable numbers that learns patterns from examples.
We tried a small one on the 4 days of data we have. **It learned nothing useful**: its times were the same as
Passio's. A simpler model, "trees" (many small yes/no rules added together), did a little better than Passio, and
it ran in under a minute.

So the plan is: **use the simple models now, and come back to deep learning later**, in about mid-December, when
there are 8 to 10 weeks of data (including Thanksgiving Break and finals), or when we start feeding the model each
bus's recent GPS trail.

## Why the simple models win for now
1. **Not enough examples yet.** A neural network needs many examples of every stop at every time of day. Four days
   is far too few. Tree models handle small data much better.
2. **The big misses come from things the data does not show.** Most of Passio's large errors happen when a bus
   leaves the end of its line late (a driver break, a long wait). No model, simple or deep, can predict what it
   was never told. Better inputs will help more than a bigger model.
3. **It has to run on the phone.** A simple model is a small table or a set of rules, easy to put in the app. A
   neural network is much harder to carry in both the website and the iPhone app.

## The goal, and how it is scored
- **The 10% rule**: a prediction made 20 minutes ahead should be right within 2 minutes (10% of 20).
- **Too late is worse than too early**: the scoring allows a little early, but almost no late.
- Each model is tested on days it has never seen: it learns on earlier days and is scored on the next day.

## What we found (Oct 14 and 15)
Share of buses where the time was close enough (percent):

| How far ahead | Passio | Trees | Neural network |
|---|---|---|---|
| under 6 min | 4.1 | 4.1 | 4.1 |
| 6 to 10 min | 6.9 | 7.0 | 6.9 |
| 10 to 15 min | 11.2 | 12.0 | 11.2 |
| 15 to 20 min | 18.4 | 19.8 | 18.4 |
| 20 to 30 min | 23.6 | 25.7 | 23.6 |
| 30 to 45 min | 12.3 | 10.7 | 12.3 |

The trees were also too late a little less often than Passio. But two test days are not enough to be sure: the
project only shows riders a new time after **at least 10 test days** prove it is better (around Nov 5 to 12). The
table also shows the hard truth: even Passio is rarely close enough by this strict rule, so small corrections
alone will not reach the goal.

## How to run it yourself
1. Click **Open the notebook in Colab** above (sign in with any Google account).
2. Optional: **Runtime > Change runtime type**. The default CPU is fine; pick a T4 GPU only if you turn on the
   neural network.
3. Click **Runtime > Run all**. It downloads the public data by itself. It takes a few minutes.
4. Read the results table and the verdict at the end. The results are also saved as files you can download.

**Cost**: free. The free Colab tier is enough; nothing needs to be paid for.

## What to do next
- Keep the data collection running every day: each day is one more test day.
- Rerun the notebook around **Nov 5 to 12** (10 test days) to see whether the trees pass the bar for real.
- Improve the inputs: tell the model when a bus is waiting at the end of its line, and how the previous bus did.
- Try the neural network again around **mid-December**, or when the GPS trails are added.

## Words used here
- **Model**: a program that learns a rule from examples.
- **Trees**: a model made of many small "if this, then that" rules added together.
- **Neural network (deep learning)**: a model with many adjustable numbers; strong with lots of data, weak with little.
- **Lead**: how far ahead a prediction was made (20 minutes before the bus came, for example).
- **Test day**: a day the model never learned from, used only to check it.
