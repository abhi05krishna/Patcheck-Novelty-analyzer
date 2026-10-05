export const researchLinks = [
  {
    title: "arXiv: newly submitted research",
    url: "https://arxiv.org/list/cs/new",
  },
  {
    title: "Nature — latest research",
    url: "https://www.nature.com/nature/research-articles",
  },
  { title: "Google Patents search", url: "https://patents.google.com/" },
];

export const demoResult = {
  overallNoveltyScore: 0.72,
  chunks: [
    {
      topMatches: [
        {
          paperTitle: "Retrieval-Augmented Evaluation for Scientific Claims",
          arxivId: "2402.03121",
          similarity: 0.41,
          rerankScore: 0.63,
        },
      ],
    },
  ],
  recommendation: {
    summary:
      "Your framing has a differentiated angle, with overlap around retrieval evaluation.",
    noveltyVerdict: "Promising differentiated direction",
    recommendations: [
      "State the research gap in one falsifiable sentence.",
      "Separate your method from the closest retrieval baseline.",
      "Add a brief limitations paragraph for your corpus coverage.",
    ],
  },
};
