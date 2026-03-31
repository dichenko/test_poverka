export interface ReportMailContentInput {
  reportType: string;
  reportDate: string;
  organizationName?: string | null;
}

export function buildReportMailContent(input: ReportMailContentInput) {
  if (input.reportType === "arshin") {
    return {
      subject: `Административный отчет Аршин за ${input.reportDate}`,
      text: `Во вложении отчет Аршин за ${input.reportDate}.`
    };
  }

  if (input.reportType === "balance_arshin") {
    return {
      subject: `Административный баланс Аршин за ${input.reportDate}`,
      text: `Во вложении отчет баланса Аршин за ${input.reportDate}.`
    };
  }

  const orgName = input.organizationName?.trim() || "организации";
  return {
    subject: `Отчет по поверкам для ${orgName} за ${input.reportDate}`,
    text: `Во вложении отчет по организации ${orgName} за ${input.reportDate}.`
  };
}
