# Imposto com data de corte reescreve dias futuros

Salvar imposto com data de vigência atualiza a taxa corrente e reescreve `daily_entries.tax_rate` de todos os dias com `date >= corte`; dias anteriores ficam intactos e cada dia segue guardando a própria taxa. Sem tabela de vigências — o audit é o `tax_rate` por dia.
