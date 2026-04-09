# CSH Dashboard Stakeholder Brief

Date: 2026-04-09
Audience: Operations and business stakeholders
Purpose: Explain, in plain language, what is being built, why it matters, and how to think about the numbers

## Executive Summary

NeoLore is building a new internal CSH call dashboard so the team can see a clearer and more trustworthy picture of call activity.

The main reason this work matters is simple: call reporting sounds easy, but in practice it is easy to count the same customer call more than once, or to label a call incorrectly. If that happens, the business can make decisions based on numbers that look precise but are actually misleading.

This dashboard is being designed specifically to avoid that problem.

Part 1 focuses on building a reliable foundation first. That means:

- bringing the raw call data into one place
- organizing it in a way that reflects real customer calls more accurately
- calculating the approved KPIs from that organized data
- adding checks so the team can spot when two counting methods disagree
- making the results visible in a simple operational dashboard

Just as important, Part 1 is not trying to do everything at once. It is intentionally limited so the team can first prove that the core numbers are dependable before adding more advanced reporting later.

## What Problem Are We Solving?

The problem is not just "we need a dashboard."

The real problem is that the business needs a dependable way to answer questions like:

- How many calls really came in?
- How many were dropped?
- How many went to English, French, or AI/overflow routing?
- How long are calls lasting?
- Are we seeing patterns by day or by hour?

Those sound like straightforward questions, but with telephony systems they often are not straightforward at all.

One customer call can create multiple system records as it moves through menus, queues, and destinations. If someone simply counts all of those raw records, the result can be much higher than the real number of customer calls.

That means two people can look at the same source system and come back with different answers depending on how they counted.

From an operations standpoint, this is a serious issue. If the team cannot trust the basic numbers, then:

- staffing decisions can be distorted
- dropped-call trends can look better or worse than they really are
- AI/overflow volumes can be misunderstood
- performance conversations can start from the wrong assumptions

So the dashboard is not just a reporting project. It is also a data-trust project.

## Why Call Counts Are Harder Than They Look

This is the most important section in the whole document.

If a non-technical stakeholder understands this section, they will understand why the project is being built the way it is.

### A system record is not always the same thing as a customer call

When a caller enters the phone system, that caller may:

1. hit an auto attendant
2. move into a queue
3. get sent to another queue or destination
4. reach a person, or hang up before that happens

The phone platform may create a separate record for several of those steps.

So even though the customer experienced one phone call, the system may store several rows about it.

If someone counts those rows as if each row were a separate call, the total becomes inflated.

This is why the technical docs keep repeating the idea that "raw CDR count is not call count."

That line may sound technical, but the business meaning is simple:

"Do not mistake system activity for customer volume."

### An "answered" signal does not always mean a human answered

Some systems mark a call as answered when an automated menu or automated step picks it up.

That can be useful for some types of technical tracking, but it can be misleading if someone tries to use that same signal to decide whether a customer actually reached a person.

This matters because dropped-call reporting can easily become wrong if the wrong signal is used.

The project therefore avoids making dropped-call decisions from that raw answered field alone.

### Queue totals are useful, but they are not the whole story

Queue-level reporting is still important. It gives helpful operational totals and trends.

But queue totals can overlap with each other when the same customer interaction touches more than one stage.

So queue totals are still used in this project, but carefully:

- sometimes as a cross-check
- sometimes for queue-level averages
- not blindly as the only source of truth for every KPI

This is a key idea in the dashboard:

some numbers come directly from queue reporting, and some numbers must come from a cleaner, deduplicated representation of the call journey.

## The Core Counting Problem in Very Simple Terms

This section is worth slowing down for, because it explains why the project is being so careful.

When operations says "call volume," the business usually means:

"How many real customer calls came through the experience?"

But the phone platform does not naturally store data that way.

Instead, it stores a technical record for each step or touchpoint in that journey.

So the dashboard has to distinguish between:

- one real customer call
- the multiple technical records created while that call moved through the system

### Simple comparison

| Concept | What it represents | Count for 1 real call |
|---|---|---|
| Call | The full customer journey from start to finish | 1 |
| CDR | One technical segment or hop within that journey | 3-5+ is possible |

This is the heart of the issue.

If someone counts CDRs as if they were calls, the result will almost always be too high.

### The three biggest reporting pitfalls

#### Pitfall 1: Counting raw CDRs will overcount actual calls

This is the most basic trap.

One customer may call once, but the system may create several records as that customer moves through the menu, the queue, and possibly an agent or another routing step.

So:

- 1 customer experience does not always equal 1 raw record
- 1 customer experience may equal several raw records

That is why the dashboard is building a logical-call layer before trusting the final KPIs.

#### Pitfall 2: Filtering for "Incoming" calls is still too broad

At first glance, it may sound reasonable to say:

"Let us just count everything marked as incoming."

The problem is that this can still capture all incoming calls for the company, not just the calls that truly entered the specific queue or routing path the business is trying to measure.

In plain language:

- "incoming to the company" is not always the same thing as "entered this queue"
- the business question is narrower than the raw system label

That is why the project does not rely on that one raw field by itself for the key queue-entry logic.

#### Pitfall 3: An answered timestamp can make a call look handled when it was not

If an auto attendant answers in order to play a menu, the system can fill in an answered-related field even though no human agent actually spoke with the caller.

That creates a dangerous illusion.

The record can look like the call was successfully handled, even when the customer may never have reached a person.

This is exactly why dropped-call logic is being treated so carefully in the project.

### The business meaning of all this

The dashboard is not being built in a complicated way for the sake of complexity.

It is being built this way because the source system speaks in technical events, while operations needs business meaning.

The project’s job is to translate from one to the other carefully enough that the final numbers are useful, explainable, and believable.

## What Part 1 Is Doing

Part 1 is building the first trustworthy version of the dashboard.

It is not trying to solve every reporting need in one go. Instead, it is doing the work in the right order:

1. collect the raw source data
2. reorganize it into a more meaningful form
3. calculate the approved metrics
4. show those metrics in a dashboard
5. validate the results before moving further

In plain language, Part 1 is building the reporting backbone.

### What users will see

The dashboard will support simple operational views such as:

- Today
- This Week
- This Month

It will include the approved KPI set for Part 1, plus the required short-call metric.

It will also include a manual refresh workflow so the team can trigger a data refresh when needed, instead of waiting for a more advanced automation layer that may come later.

### What the system will do behind the scenes

Behind the dashboard, the system will:

- connect to the Versature source
- pull the relevant call and queue data
- store that source data in a database
- rebuild a cleaner "logical call" view
- calculate KPI results from that cleaned-up data
- store daily summaries for reporting

This matters operationally because it means the dashboard is not just displaying numbers from a spreadsheet or one-off export. It is building a repeatable reporting process.

## What a "Logical Call" Means in Simple Language

"Logical call" is one of the most important concepts in the project.

The phrase sounds technical, but the idea is not.

A logical call means:

"our best single representation of one real customer call"

Instead of treating every raw system row as a separate event for business reporting, the project groups related rows together when they clearly belong to the same customer interaction.

That grouped result becomes the unit used for several important KPIs.

Why is that useful?

Because business users usually want to know about real customer interactions, not how many technical steps the phone platform recorded internally.

So when the dashboard counts "incoming calls," "dropped calls," or routing outcomes, it is trying to count the customer experience more faithfully.

This is the main protection against inflated or misleading totals.

## How the Dashboard Makes the Numbers More Trustworthy

The project is not asking stakeholders to "just trust the dashboard."

It is being designed so the numbers can be explained and checked.

### 1. It keeps the raw data

The system stores the original source data.

That is important because it means the team still has the original record of what came from the phone platform. Nothing is hidden or replaced.

### 2. It builds a cleaner reporting layer on top of the raw data

The system then creates the logical-call layer.

This layer exists because the raw data is too noisy to use directly for every business question.

This is a healthy reporting pattern:

- keep the original source
- create a clearer business-friendly interpretation
- use that interpretation for the KPIs that need it

### 3. It uses more than one method for the most sensitive headline number

For Total Incoming Calls, the project intentionally compares two approaches:

- a deduplicated call-based method
- a queue-based method

If those two methods drift too far apart, the system raises a warning.

That does not mean the dashboard has failed. It means the dashboard is doing something valuable: it is exposing uncertainty instead of hiding it.

For operations, this is a very good thing.

It is much safer to see a warning that says "these methods do not agree closely enough" than to see one clean-looking number that nobody has questioned.

### 4. It includes an assertion gate

An assertion gate is simply a set of sanity checks.

In business language, it means:

"Before we trust this data refresh, do the outputs make sense relative to each other?"

For example:

- dropped calls should not be greater than total incoming calls
- the exclusive routing buckets should not add up to more than the total incoming count

These are common-sense checks, but they are being built into the reporting process instead of being left to chance.

### 5. It requires manual validation before broader rollout

Part 1 is not considered complete just because the code runs.

A real historical day still has to be reviewed against human understanding of the operation.

This is important because operations teams do not work in theory. They work in reality.

The final question is not only "does the system calculate something?"

The final question is:

"When we compare this to the business's understanding of a real day, does it make sense?"

## What Operations Will Be Able to Use It For

From an operations standpoint, the dashboard should help with several practical needs.

### Daily visibility

Leaders and supervisors should be able to see the current picture for:

- incoming volume
- dropped volume
- language routing
- AI/overflow routing
- call length patterns
- short-call behavior

That supports day-to-day monitoring without having to manually piece together information from raw exports.

### Trend awareness

By looking at Today, This Week, and This Month, operations can move beyond isolated snapshots and start seeing patterns.

Examples:

- Is dropped-call volume rising?
- Are certain days heavier than others?
- Are calls getting longer at certain times?
- Is AI/overflow usage changing?

### Better conversations

Even when the dashboard does not answer every question yet, it gives the team a more stable starting point for discussions.

That matters because a lot of operational confusion comes from people debating the numbers before they can even debate the business issue.

If the reporting base becomes more dependable, the discussion can move more quickly to:

- what happened
- why it happened
- what should be done next

## What Part 1 Is Not Doing Yet

This is also very important.

Part 1 is intentionally limited.

That is not a weakness. It is a way to reduce risk.

The project is deliberately not trying to solve every analytics question in one phase.

Part 1 does not fully deliver:

- ConnectWise-based metrics
- MSP Process-driven AI quality metrics
- full Voice Assist distinction
- broader Part 2 KPI additions
- user authentication and role-based access
- every future operational slice the business may eventually want

The reason is simple:

the team first wants to make sure the core call-counting foundation is sound.

That is the right order.

If the foundation is weak, adding more dashboards on top of it only creates faster confusion.

If the foundation is strong, later enhancements become safer and more useful.

## Why This Approach Is Better Than Rushing to a Bigger Dashboard

It may be tempting to ask, "Why not just build the full thing now?"

The answer is that reporting projects often fail when they move too quickly from raw source data to polished charts.

When that happens, the visuals look impressive, but the organization later discovers:

- the definitions were inconsistent
- the counts were inflated
- the team could not explain the logic
- confidence in the dashboard dropped

This project is trying to avoid that trap.

It is doing the less glamorous but more valuable work first:

- define the counting rules
- explain the meaning of each KPI
- protect against common counting mistakes
- create cross-checks
- validate before expanding scope

That is exactly what a good operations reporting program should do.

## What Success Looks Like

For a non-technical stakeholder, success should not be defined as "the app exists."

Success should mean:

- the team can open the dashboard and understand the core call picture
- the headline numbers are easier to explain
- there is less confusion about what is being counted
- known counting pitfalls are actively guarded against
- the business has enough confidence in Part 1 to decide whether to move into Part 2

In other words, success is not just visibility.

Success is believable visibility.

## Final Takeaway

This dashboard is being built to answer an operational need, but it is being built carefully because call reporting is easy to get wrong.

The project is not only creating charts. It is creating a more dependable way to describe what is happening in the phone operation.

Part 1 is about getting the fundamentals right:

- bring the data together
- represent customer calls more accurately
- calculate the approved KPIs
- check the logic
- validate the results

Once that foundation is trusted, the business will be in a much stronger position to expand the dashboard with more advanced reporting in Part 2.
