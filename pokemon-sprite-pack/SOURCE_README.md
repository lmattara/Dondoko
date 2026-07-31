
# Pokémon Icons DB

## Acknowledgements

This project was made possible thanks to the information compiled by the [Poképédia](https://www.pokepedia.fr) and [Bulbapedia](https://bulbapedia.bulbagarden.net/) wikis.

The vast majority of icons from gen 1 to 8 was obtained thanks to the [PokéSprite project](https://github.com/msikma/pokesprite). These include official sprites for all Pokémons, as well as community-made sprites for alternate forms and shiny forms.

Icons for generation 9 were obtained from a [resource pack](https://www.pokecommunity.com/threads/generation-9-resource-pack-v21-1.527398/) compiled by the user Caruban on PokéCommunity. The original artists are : Vent, Katten, leParagon, Cesare_CBass, AlexandreV2.0, Carmanekko, GRAFAIAIMX.

The icon sprites are © Nintendo/Creatures Inc./GAME FREAK Inc.

## Scripts

For conveniency, this repository contains a [Makefile](./Makefile) that allows running example scripts. The following commands are available :

- `venv`: Performs the setup of the Python virtual environment for running scripts, must only be called once at setup.
- `pip`: Installs and/or updates pip packages in the venv.
- `check`: Runs the [check.py](./scripts/check.py) script, verifying the [JSON schema](./schema.json) and other constraints on the JSON data. Also checks that all sprites are available.
- `spritesheets`: Runs the [generate_spritesheets.py](./scripts/generate_spritesheets.py) script, which generates sprite sheets and CSS styles to access the individual sprites.
- `mermaid`: Runs the [generate_mermaid.py](./scripts/generate_mermaid.py) script, which generates a Mermaid diagram containing all Pokémon forms. Sadly, it appears to be too large to display properly...

## Data structure

The provided JSON contains information about all known Pokémons until generation 9 and the various forms they can take.

The root object is a list of [groups](#group).

### Group

A group contains information related to a given Pokédex entry (identified by a unique number).

| Key            | Type                         | Default     | Constraints   | Description                                                                   |
|----------------|------------------------------|-------------|---------------|-------------------------------------------------------------------------------|
| `number`       | `int`                        | (mandatory) | `val > 0`     | Unique number identifying the group                                           |
| `evolves_from` | `int` or `null`              | `null`      |               | Identifier of the group from which Pokémons in the current group might evolve |
| `common_names` | [translated_names] or `null` | `null`      |               | Group names for variant-only groups                                           |
| `forms`        | `list`                       | (mandatory) | items: [form] | List of forms the Pokémon can be found in                                     |

Assumptions :

- A given Pokémon can never evolve from two different Pokémon species.
- There is never a loop in the evolution chain (i.e. a Pokémon which evolves into one of its pre-evolutions).

Additional constrains :

- A given `number` can only appear once in the list. More specifically, all groups are sorted by number in the list so that any group with number `n` can be found at the index `n-1`.
- If no form in the group has a default variant, it must provide the `common_names` property, which can be used as the generic name to refer to the entire group.

### Form

| Key                  | Type                     | Default     | Constraints             | Description                                                                              |
|----------------------|--------------------------|-------------|-------------------------|------------------------------------------------------------------------------------------|
| `names`              | [translated_names]       | (mandatory) |                         | The form's names                                                                         |
| `links`              | [wiki_links]             | (mandatory) |                         | Wiki links for this form/Pokémon                                                         |
| `types`              | `list`                   | (mandatory) | items: [type], unique   | The types of the Pokémon in this form                                                    |
| `gen`                | `int`                    | (mandatory) | `1 <= val <= 9`         | Generation in which the form was introduced                                              |
| `variant`            | `string` or `null`       | `null`      |                         | The variant associated with this form, `null` for the default/base form                  |
| `evolution_variants` | `list` or `null`         | `null`      | items: `string`, unique | The non-default variant(s) required to evolve in this form                               |
| `gender_variant`     | `bool`                   | `false`     |                         | Whether or not this form has a different appearence for males and females                |
| `gender_ratio`       | [gender_ratio] or `null` | `null`      |                         | Repartition of male/female individuals in the current form, mandatory if the form is not temporary. |
| `derives`            | [derivation] or `null`   | `null`      |                         | Indicates that the current form derives from other forms of the same Pokémon, if present |

Additional constrains :

- A given `variant` can only appear once per group.
- The `evolution_variants` property must be null if the `evolves_from` group-level property is null.
- A form with a non-null `evolution_variants` must have a null `derives` property, and conversely (derivated forms do not evolve directly, they are obtained from another form of the same Pokémon, which might have previously evolved).
- All variants in `evolution_variants` must exist in the group associated with the `evolves_from` property (at group level). Additionally, they cannot refer to a derived form.
- A form with a gender variant must have a gender ratio, and the ratio must allow for both male and female individuals.
- The form with the default variant (`"variant": null`, if any) cannot be derived from another form.
- The first form in the list is the one that "best respresents" the species :
    - If the group has a null variant form, it must be the first in the list.
    - Else, the first form cannot be a derived form

### Derivation

This structure describes how a given form of a Pokémon is obtained from other forms of the same Pokémon.

| Key           | Type   | Default     | Constraints             | Description                                                           |
|---------------|--------|-------------|-------------------------|-----------------------------------------------------------------------|
| `from`        | `list` | (mandatory) | items: `string`, unique | Forms that can be transformed/derived into the current form           |
| `battle_only` | `bool` | (mandatory) |                         | Whether or not the transformation is limited to the scope of a battle |

Assumptions :

- There is never a loop in the derivation chain (i.e. a form which derives from another form, which itself derives from the former). In the case of Pokémons that can switch freely between multiple forms (e.g. [Furfrou #0676], [Deoxys #0386]), we will consider that one of these forms is the "base" and that the others derive from it, for the sake of simplicity.

Additional constraints :

- All variants in the `from` list must exist in the group that declared the derivation.
- If any of the variant in the list is associated with a battle-only form, the current derivation must also be battle-only.

### Translated names

All names must be available in French and English.

| Key  | Type     | Default     | Description      |
|------|----------|-------------|------------------|
| `en` | `string` | (mandatory) | The English name |
| `fr` | `string` | (mandatory) | The French name  |

### Wiki links

| Key          | Type     | Default     | Description           |
|--------------|----------|-------------|-----------------------|
| `bulbapedia` | `string` | (mandatory) | The [Bulbapedia] link |
| `pokepedia`  | `string` | (mandatory) | The [Poképédia] link  |

### Types

Enumeration that lists all available Pokémon types :

- `"normal"`
- `"fighting"`
- `"flying"`
- `"poison"`
- `"ground"`
- `"rock"`
- `"bug"`
- `"ghost"`
- `"steel"`
- `"fire"`
- `"water"`
- `"grass"`
- `"electric"`
- `"psychic"`
- `"ice"`
- `"dragon"`
- `"dark"`
- `"fairy"`

### Gender ratios

Enumeration that lists all possible gender ratios within a species :

- `"only-m"`
- `"7m-1f"`
- `"3m-1f"`
- `"1m-1f"`
- `"3f-1m"`
- `"7f-1m"`
- `"only-f"`
- `"ungendered"`




[Bulbapedia]: https://bulbapedia.bulbagarden.net
[Poképédia]: https://www.pokepedia.fr/

[form]: #form
[derivation]: #derivation
[translated_names]: #translated-names
[wiki_links]: #wiki-links
[type]: #types
[gender_ratio]: #gender-ratios

[Deoxys #0386]: https://bulbapedia.bulbagarden.net/wiki/Deoxys_(Pok%C3%A9mon)
[Furfrou #0676]: https://bulbapedia.bulbagarden.net/wiki/Furfrou_(Pok%C3%A9mon)
