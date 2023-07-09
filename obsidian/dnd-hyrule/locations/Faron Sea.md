#location [[Faron Region]]

The Faron Sea is the sea off the western part of Hyrule's south coast, notionally part of Faron but also bordering eastern Gerudo.

### Locations

- Clarnet Coast
- Cape Cresia and Soka Point
- Martha's Landing
- Aris Beach
- Komo Shoreline
- Puffer Beach

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
| 1-6  | Mighty Bananas | 6        |
| 7-12 | Hearty Durian  | 6        |
^faron-sea-foraging

##### Fishing

| d6  | Collectible    | Qty (6) |
| --- | -------------- | ------- |
| 1-2 | Armored Carp   | 2       |
| 3-4 | Mighty Porgy   | 2       |
| 5-6 | Staminoka Bass | 2       |
^faron-sea-fishing
