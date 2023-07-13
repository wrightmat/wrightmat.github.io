#location [[Lanayru Region]]

Mount Lanayru is a large mountain located in the south-eastern corner of the Lanayru region. It is located north of Hateno Village, where it is the largest mountain that is part of the Lanayru Range. The Spring of Wisdom is located on the mountain.

Given its higher elevation and colder climate, players will need to make plans to survive the colder climate. Naydra, one of the three dragons, can generally be found at the peak of Mount Lanayru, near the Spring of Wisdom.

```ad-info
title: Extreme Cold

A creature exposed to extreme cold must succeed on a DC 10 Constitution saving throw at the end of each hour or gain one level of exhaustion. Creatures with resistance or immunity to cold damage automatically succeed on the saving throw, as do creatures wearing cold weather gear (thick coats, gloves, and the like) and creatures naturally adapted to cold climates.
```

### Locations

- Spring of Wisdom
- Naydra Snowfield
- Walnot Mountain
- Lanayru Road
- Lanayru Promenade

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Collecting

##### Foraging

| d12   | Collectible   | Qty (12) |
| ----- | ------------- | -------- |
| 1-6   | Chillshroom   | 6        |
| 7-10  | Iceberry      | 4        |
| 11-12 | Cool Safflina | 2        |
^mount-lanayru-foraging

##### Fishing

| d6  | Collectible    | Qty (6) |
| --- | -------------- | ------- |
| 1-4 | Chillfin Trout | 4       |
| 5-6 | Hyrule Bass    | 2       |
^mount-lanayru-fishing
