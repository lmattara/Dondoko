## Estilo de execução

- Foque exclusivamente no que foi pedido no prompt. Não expanda o escopo pra itens relacionados, refatorações extras, ou "melhorias" que não foram solicitadas.
- Não rode testes, builds, ou comandos de verificação automaticamente após uma mudança, a menos que isso tenha sido pedido explicitamente no prompt. Se eu quiser que você teste algo, eu vou pedir.
- Não faça investigação exploratória ampla do código quando o pedido já for específico e direto (ex: um bug fix pontual, um ajuste de UI, uma mudança de valor). Só investigue mais a fundo quando o problema for genuinamente ambíguo ou a causa não estiver clara.
- Para tarefas curtas e diretas (ajustar um valor, corrigir um texto, adicionar um botão simples), aplique a mudança direto, sem etapas intermediárias de planejamento longo — mostre o diff e pronto.
- Reserve investigação mais profunda, testes, e divisão em etapas apenas para tarefas que eu sinalizar como complexas ou que envolvam múltiplos arquivos/sistemas.
- Se não tiver certeza se algo está dentro do escopo pedido, prefira perguntar rapidamente ao invés de assumir e fazer a mais.
- Nunca use em dash (—) em nenhum texto que você escrever, seja em código, comentários, textos do jogo, mensagens de commit, ou nas suas próprias respostas. Use vírgula, ponto, ou reformule a frase ao invés disso.

## Exceções — onde vale ser mais cuidadoso mesmo sem eu pedir

- **Sistema de batalha** (turnos, status effects como Poison/Burn/Sleep, cálculo de dano, condições de vitória/derrota): não rode testes automaticamente aqui — eu mesmo vou testar manualmente depois de cada mudança. Só aplique a mudança e mostre o diff.
- **Integração com Supabase** (tabelas, RLS, constraints, saves): valide que a query/schema funciona antes de finalizar, já que erros aqui afetam dados persistidos de verdade.
- **Mudanças que afetam múltiplos arquivos ou sistemas ao mesmo tempo**: mesmo que o pedido pareça simples, se a mudança se propaga por vários lugares, vale confirmar que nada mais quebrou.
- Fora dessas exceções, siga as regras de execução rápida acima.
