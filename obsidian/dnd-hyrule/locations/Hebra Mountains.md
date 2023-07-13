#location [[Hebra Region]]

The Hebra Mountains are a very cold and mountainous area in the north of the Hebra Region with lots of peaks and summits to climb. The area also has large snow-covered slopes, making it an ideal Shield Surfing location. Despite the extreme cold, the Hebra Mountains are littered with Hot Springs; none of the remaining lakes have hazardously cold water, and the ones above ground are flanked with powerful updraft vents. 

```ad-info
title: Extreme Cold

A creature exposed to extreme cold must succeed on a DC 10 Constitution saving throw at the end of each hour or gain one level of exhaustion. Creatures with resistance or immunity to cold damage automatically succeed on the saving throw, as do creatures wearing cold weather gear (thick coats, gloves, and the like) and creatures naturally adapted to cold climates.
```

### Locations

- Hebra Village (formerly Selmie's Spot)
- Hebra Plunge
- Hebra Trailhead Lodge
- Sherfin's Secret Hot Spring
- Goflam's Secret Hot Spring
- Sturnida Hot Spring
- Hebra Peak

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Collecting

##### Foraging

| d12  | Collectible    | Qty (12) |
| ---- | -------------- | -------- |
| 1-4  | Iceberry       | 4        |
| 5-7  | Cool Safflina  | 3        |
| 8-10 | Chillshroom    | 3        |
| 11   | Hearty Truffle | 1        |
| 12   | Fairy          | 1        |
^hebra-mountains-foraging

##### Fishing

| d6  | Collectible    | Qty (6) |
| --- | -------------- | ------- |
| 1-5 | Chillfin Trout | 5       |
| 6   | Hearty Salmon  | 1       |
^hebra-mountains-fishing
