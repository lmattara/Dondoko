## Texto pronto (Discord/site)

📢 **Updates desde sexta-feira (24/07)**

Foram alguns dias intensos de trabalho! Aqui vai um resumo do que mudou no jogo:

**Novidades**
- Agora temos 18 Gym Leaders, com times sorteados por tier de força e pools próprias para cada tipo (incluindo o novo Fairy Gym).
- 12 novos retratos de Gym Leader.
- Nova sequência no Cruise Ship: cameo do Rival, embarque, chegada em Indigo Plateau, e a batalha contra o First Mate Thaise.
- Popups novos para capturas de Lendário/Mítico, Mega Evolution e para o "sense" do Absol.
- Fishing Bait e rework do sistema de conquistas (achievements).
- Botão de convite pro Discord na home (substituiu o antigo botão de bug report).

**Balanceamento**
- Nuzlocke ficou mais justo: mais trocas voluntárias por batalha, chance de captura melhor, Potion cura tudo.
- Dificuldade geral suavizada pra quem tá começando, com endgame menos absurdo.
- Times dos Gym Leaders e ofertas de troca agora respeitam melhor a força do jogador.
- IA de batalha ficou mais esperta: pondera dano esperado e efetividade de tipo.

**Correções de bugs**
- Mega Evolution com escolha de forma (Charizard, Mewtwo, Raichu X/Y) não estava funcionando, corrigido.
- Meltan finalmente evolui pra Melmetal.
- Corrigido loop de encontro pós-Rival e vários bugs de checkpoint que zeravam a run sem necessidade.
- Corrigido Mega Tackle, implementado Counter/Mirror Coat de verdade.
- Corrigido botão de Fishing que travava depois de comprar mais isca.
- Nomes no leaderboard agora são validados e escapados corretamente.

**Interface**
- Botão de voltar na tela de troca, telas de troca simplificadas.
- FAQ reorganizada e ampliada (nova seção de sistema de batalha, disclosure de arte gerada por IA, tabelas em ordem).
- Favicon, meta description e ajustes de acessibilidade (focus states).

---

## Lista por categoria (referência)

### Novidades / Conteúdo
- 18 Gym Leaders com pools por tier de força (b483acc, 264b01f, a1ae0a9, 5a77081)
- 12 novos retratos de Gym Leader (cf2d2d3)
- Cruise Ship: cameo do Rival, First Mate Thaise, dialogos de embarque, chegada em Indigo Plateau (abf7be2, 5b81849, 491fc5e)
- Popups de Lendário/Mítico, Mega Evolution e Absol sense (20cb288, 50d67ab, c111b5e, 9269b15, 6d42b1e)
- Fishing Bait + rework de achievements (Gold Digger/High Roller, Iron Nuzlocke) (719ca2e, 2770b04)
- Botão de Discord na home substituindo bug report (f26aedf)
- Botão de bug report + tabela bug_reports (adicionado e depois substituído) (20958c3, a347e5b, 04b449a)

### Balanceamento
- Nuzlocke: mais trocas voluntárias, melhor chance de captura, Potion cura tudo (a01ff52, d95e654)
- Dificuldade suavizada para novos jogadores, endgame ajustado (ca657e6)
- Times de Gym Leaders e ofertas de troca balanceados por força (b809df2, 4e06866, 8fb4bb6, 15ac88a, c616348, 9b6e64a, 5c17b50, b9c95e2)
- Bandas de BST para encontros bônus (adbb1a0, fbeb337)
- IA de batalha mais inteligente (dano esperado + efetividade de tipo) (16f98d5, 4a60d2d)
- Reroll de encontro selvagem limitado a 1 uso (645a04c)

### Correções de bugs
- Revive do último membro da Elite Four em slot desmaiado obsoleto (69d9036)
- Loop de encontro pós-Rival e skip de troca de inimigo (6792bce)
- Vários fixes de checkpoint zerando a run à toa (465c5a7, d8ef28b, 2ddc079, 5b090e3)
- Botão de Fishing travado após comprar isca (6f171d8)
- Mega Tackle bugado + Counter/Mirror Coat implementados de verdade (6d1c588)
- Meltan nunca evoluía para Melmetal (ac253d1)
- Tela de cameo do Rival renderizando atrás da tela de captura (b1d59bc)
- Mega Evolution com escolha de forma falhando silenciosamente (de6f610)
- Nomes do leaderboard sem escape/validação (cdee2c7)
- Habilidade do Absol errada na forma Mega (32a453c)

### Interface / UX
- Botão de voltar na troca, telas de troca simplificadas (4822894, 4486839)
- Banner da cena de pesca em formato quadrado (07d2f0f)
- Retrato do treinador ao lado do nome em batalha (0b0e38c)
- Favicon, meta description, focus states (0a8a3ff)
- FAQ reorganizada: alfabetização, tabela de pontuação, ordem dos modos de jogo, seção de batalha, disclosure de arte IA (529368c, 4984fae, 2ac3e2f, ca6015f, af0ccaa, a31e5bd, 750f976)
- Thumbnail de compartilhamento atualizada (ee7e9f6)
