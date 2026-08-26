Eu parei de pedir para um único modelo “planejar e codar tudo”.

Em vez disso, montei um agente de engenharia no DeepSeek Harness com um pipeline SDD:

1. GPT-5.5 xhigh inspeciona o repositório e cria PLAN.md + SPEC.md.
2. Um readiness gate bloqueia a implementação se ainda houver decisões abertas.
3. GPT-5.3-Codex high implementa a spec e escreve os testes.
4. GPT-5.5 xhigh revisa o diff, executa os checks e corrige problemas confirmados.
5. O resultado fica registrado em VERIFICATION.md.

O detalhe interessante é que o DeepSeek Harness trata tudo como plugin e seu workflow pode escolher provider e model por subagente. Como o workflow não recebe reasoning effort diretamente, criei duas rotas OpenAI: uma com xhigh como padrão para arquitetura/revisão e outra com high para implementação.

Isso não transforma IA em mágica. O ganho vem dos contratos:

• artefatos obrigatórios;
• critérios de aceite verificáveis;
• testes junto da mudança;
• falha explícita quando a spec está incompleta;
• revisão independente antes de declarar sucesso;
• nenhuma chave dentro do repositório.

Também fixei a versão do Harness, porque o projeto ainda está em developer preview e avisa que mudanças incompatíveis acontecerão.

Preparei um starter kit GitHub-ready com:

• skill sdd-code-agent;
• workflow multi-modelo;
• settings seguros por variável de ambiente;
• scripts de bootstrap e execução;
• exemplo de tarefa;
• validação local;
• tutorial completo.

Importante: assinatura do ChatGPT e uso da OpenAI API são produtos/faturamentos separados, e o acesso aos modelos depende da conta.

Se você está construindo coding agents, minha recomendação é simples: não avalie a qualidade pela confiança da resposta. Avalie pelos artefatos, pelo diff e pelos checks executados.

#AIEngineering #SoftwareEngineering #CodingAgents #OpenAI #DeepSeek #SpecDrivenDevelopment #SDD #DeveloperTools
