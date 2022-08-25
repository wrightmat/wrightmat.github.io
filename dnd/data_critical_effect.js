data_critical_effect = [
    {
        title: "Armor Pierced",
        icon: "layered-armor",
        subtitle: "Armor class halved",
        description: "Armor class is halved, rounded down",
        bullets: [
            "The hit melted an important patch of ship armor, cracked an internal support, or exposed a sensitive system. Until resolved, the ship’s Armor Class is halved, rounded down."
        ]
    },
    {
        title: "Cargo Loss",
        icon: "artificial-hive",
        subtitle: "Lose some percentage of cargo",
        description: "Lose 1d10*10% of the ship's cargo",
        bullets: [
            "The hit has gored open a cargo bay, threatening to dump the hold or expose delicate contents to ruinous damage. If not resolved by the end of the next round, lose d10*10% of the ship’s cargo."
        ]
    },
    {
        title: "Crew Lost",
        icon: "pierced-body",
        subtitle: "10% of crew are incapacitated",
        description: "10% of crew are incapacitated",
        bullets: [
            "Brave crew risk their lives to keep damaged systems operating. Describe the danger they face. If the Crisis is not resolved by the end of the next round, 10% of the ship’s maximum crew are incapacitated. Half these crewmen are dead or permanently disabled, and the other half return to duty in a week"
        ]
    },
    {
        title: "Fire!",
        icon: "fire",
        subtitle: "Something on the ship ignites",
        description: "Something on the ship ignites, spreading every turn and causing increased damage",
        bullets: [
            "The attack penetrates the hull and ignites something flammable inside the ship (lamp or cooking oil, torches, etc.).",
	    "The fire causes 1d6 hit points of damage per round for the first and second rounds, 2d6 points of damage for the third and fourth rounds, 4d6 points of damage for the fifth and sixth rounds, and so on until the fire is extinguished.",
	    "Another officer can put out fire using water, sand, magic or other standard methods if they can succeed at a DC 20 Intelligence (Investigation) check."
        ]
    },
    {
        title: "Helm Jammed",
        icon: "bubble-field",
        subtitle: "Spelljamming helm is deactivated",
        description: "Spelljamming helm is deactivated, but a saving throw can reduce the duration",
        bullets: [
            "The ship’s spelljamming helm has been jammed, magically suppressing the properties of the ship’s helm for 2d10 hours.",
	    "A creature attuned to that helm can choose to make a DC 17 Charisma saving throw. On a failed save, the creature takes 42 (12d6) psychic damage, and the helm is suppressed for 1d10 minutes instead of 2d10 hours. On a successful save, the creature takes half as much damage, and the helm is suppressed for 1d10 turns instead of 1d10 minutes."
        ]
    },
    {
        title: "Hull Breach",
        icon: "broken-shield",
        subtitle: "The ship takes damage",
        description: "Lose 10% of the ship's maximum hit points",
        bullets: [
            "The hull has been damaged in a way that is currently non-critical but is about to tear open an important compartment or crumple on vital systems. If not resolved by the end of the next round, the ship will take damage equal to 10% of its maximum hit points each round."
        ]
    },
    {
        title: "Ship Shaken",
        icon: "rocket-flight",
        subtitle: "Crew are knocked prone and take damage",
        description: "Unsecured crew are knocked prone and take 2d6 falling (bludgeoning) damage",
        bullets: [
            "All crewman not otherwise secured (Spelljammer is considered secured) must make a DC 14 Dexterity saving throw or be knocked prone and dealt 2d6 falling damage. On a critical failure, a crewman on the outside of the ship or in an area with an open hull is thrown overboard."
        ]
    },
    {
        title: "Weapon Damaged",
        icon: "imbricated-arrows",
        subtitle: "Random weapon can no longer be used",
        description: "Random weapon can no longer be used",
        bullets: [
            "One of the ship’s weapons, randomly selected by the DM, has been disabled by the hit. Already disabled systems hit by this are destroyed and cannot be repaired during combat."
        ]
    }
]