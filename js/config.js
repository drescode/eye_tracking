function hashSeed(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed) {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pickCaseForFamily(family, participantSeed) {
  const random = createSeededRandom(`${participantSeed}:${family.id}`);
  const index = Math.floor(random() * family.cases.length);
  return family.cases[index];
}

function materializeStimulusPage(family, caseDefinition, pageIndex) {
  return {
    id: `${family.id}-${caseDefinition.id}`.toLowerCase(),
    pageNumber: pageIndex + 1,
    title: `${family.label} · ${caseDefinition.id}`,
    familyId: family.id,
    familyLabel: family.label,
    caseId: caseDefinition.id,
    caseTitle: caseDefinition.title,
    template: caseDefinition.template,
    imageSetId: caseDefinition.imageSetId,
    frameAspectRatio: caseDefinition.frameAspectRatio || "4 / 5",
    prompt: caseDefinition.prompt,
    question: caseDefinition.question,
    options: caseDefinition.options.map((option, optionIndex) => ({
      id: `${caseDefinition.id.toLowerCase()}-${option.variantId || optionIndex + 1}`,
      variantId: option.variantId || `variant-${optionIndex + 1}`,
      label: option.label || `Variant ${String.fromCharCode(65 + optionIndex)}`,
      title: option.title || option.label || `Variant ${String.fromCharCode(65 + optionIndex)}`,
      image: option.image,
      placeholder: Boolean(option.placeholder),
      notes: option.notes || [],
    })),
    brief: {
      retailer: caseDefinition.retailer,
      product: caseDefinition.product,
      manipulations: caseDefinition.manipulations,
      aoiDefinitions: caseDefinition.aoiDefinitions,
      expectedMetrics: caseDefinition.expectedMetrics,
      expectedOutcome: caseDefinition.expectedOutcome,
      notes: caseDefinition.notes || [],
      assetGuidance: caseDefinition.assetGuidance || "",
    },
  };
}

export function buildStimulusPlan(participantSeed = "preview-seed") {
  return SOUTH_AFRICA_CASE_FAMILIES.map((family, pageIndex) =>
    materializeStimulusPage(
      family,
      pickCaseForFamily(family, participantSeed),
      pageIndex,
    ),
  );
}

export function getStimulusPlan(session, config = null) {
  if (session?.stimulusPlan?.length) {
    return session.stimulusPlan;
  }

  if (config?.stimulusPages?.length) {
    return config.stimulusPages;
  }

  return buildStimulusPlan("preview-seed");
}

const SOUTH_AFRICA_CASE_FAMILIES = [
  {
    id: "brand-equity",
    label: "Brand Equity",
    cases: [
      {
        id: "BE1",
        title: "KOO vs Checkers Housebrand Baked Beans",
        template: "A",
        imageSetId: "be1-checkers",
        retailer: "Checkers Sixty60",
        product:
          "KOO Baked Beans in Tomato Sauce 400g vs Checkers Housebrand Baked Beans in Tomato Sauce 410g",
        prompt:
          "Review the product tiles and decide which listing you would tap if you were shopping on Checkers Sixty60.",
        question: "Which tile would you select?",
        manipulations: [
          "Keep the native Sixty60 card layout.",
          "Use live prices R17.99 and R12.99.",
          "Set the KOO wordmark to 18% card width and the private-label mark to 10%.",
          "Use no extra promo badge.",
          "Style the CTA chip in sale red #D71920 with white text.",
        ],
        aoiDefinitions: [
          "Left/right brand blocks",
          "Price blocks",
          "CTA chips",
        ],
        expectedMetrics: [
          "TTFF_brand on KOO 150-250 ms faster",
          "Dwell_brand +12%",
          "Click share +8 pp or more",
        ],
        expectedOutcome:
          "Familiar national-brand coding should attract earlier attention than store-brand coding even in a price-visible grocery context.",
        notes: ["A", "B", "E"],
        assetGuidance:
          "Replace placeholders with official Checkers card screenshots at 1600x900 and pack cut-outs at 1200x1200 or larger.",
        options: [
          {
            variantId: "koo",
            label: "KOO",
            title: "KOO branded tile",
            image: "./pics/1.jpg",
            placeholder: true,
          },
          {
            variantId: "housebrand",
            label: "Housebrand",
            title: "Checkers Housebrand tile",
            image: "./pics/11.jpg",
            placeholder: true,
          },
        ],
      },
    ],
  },
  {
    id: "segmentation",
    label: "Segmentation",
    cases: [
      {
        id: "SEG1",
        title: "Lenovo V15 on Makro Business",
        template: "B",
        imageSetId: "seg1-makro",
        frameAspectRatio: "16 / 10",
        retailer: "Makro Business",
        product: "Lenovo V15 AMD Ryzen 3 laptop listing",
        prompt:
          "Review the laptop listing and choose the framing that feels most relevant to you.",
        question: "Which listing would you open?",
        manipulations: [
          "Keep the same hero image and price.",
          "Variant A headline: Built for students with blue accent #2563EB.",
          "Variant B headline: Built for business with charcoal #1F2937.",
          "Student chips sit above specs; professional chips sit above price.",
        ],
        aoiDefinitions: ["Headline chips", "Specs", "Price", "CTA"],
        expectedMetrics: [
          "Students dwell longer on price/chips",
          "Professionals dwell longer on specs",
          "Flag AOI dwell differences above 12%",
        ],
        expectedOutcome:
          "Segment framing should redirect gaze without changing the underlying product.",
        notes: ["A", "E"],
        assetGuidance:
          "Replace placeholders with an official Makro Business screenshot and laptop cut-out at 1600x900 or larger.",
        options: [
          {
            variantId: "students",
            label: "Students",
            title: "Built for students",
            image: "./pics/22.jpg",
            placeholder: true,
          },
          {
            variantId: "business",
            label: "Business",
            title: "Built for business",
            image: "./pics/222.jpg",
            placeholder: true,
          },
        ],
      },
      {
        id: "SEG3",
        title: "Coca-Cola 440ml localized sports framing",
        template: "C",
        imageSetId: "seg3-coke",
        frameAspectRatio: "3 / 4",
        retailer: "Coca-Cola South Africa promotion",
        product: "Coca-Cola Original Taste 440ml PET",
        prompt:
          "Review the promotional panels and choose the one most likely to make you engage with the campaign.",
        question: "Which promo would you enter?",
        manipulations: [
          "Use the same bottle hero across all variants.",
          "Render headlines: Win with Coke, Be a Bok, and Win with Coke / Mzansi edition.",
          "Use dominant background red #E41E26 with white copy.",
          "Optional local-language line can sit beneath the English headline.",
        ],
        aoiDefinitions: ["Headline", "Bottle", "QR / CTA block"],
        expectedMetrics: [
          "TTFF_headline faster in localized variants",
          "Click-to-enter rises by 8 pp",
        ],
        expectedOutcome:
          "Sports and localized cultural cues should increase short-form promotional engagement in South Africa.",
        notes: ["A", "B", "E"],
        assetGuidance:
          "Replace placeholders with the official Coca-Cola promo page and bottle hero at 1500 px or larger.",
        options: [
          {
            variantId: "win-with-coke",
            label: "Win with Coke",
            title: "Generic campaign framing",
            image: "./pics/3.jpg",
            placeholder: true,
          },
          {
            variantId: "be-a-bok",
            label: "Be a Bok",
            title: "Sports framing",
            image: "./pics/33.jpg",
            placeholder: true,
          },
          {
            variantId: "mzansi",
            label: "Mzansi edition",
            title: "Localized cultural framing",
            image: "./pics/333.jpg",
            placeholder: true,
          },
        ],
      },
    ],
  },
  {
    id: "product",
    label: "Product Presentation",
    cases: [
      {
        id: "PRD1",
        title: "FUTURELIFE High Protein Smart Food",
        template: "A",
        imageSetId: "prd1-futurelife",
        retailer: "FUTURELIFE",
        product: "FUTURELIFE High Protein Smart food 500g",
        prompt:
          "Review the three product presentations and choose the one most likely to drive trial or purchase.",
        question: "Which presentation would you choose?",
        manipulations: [
          "Variant A = pack-only.",
          "Variant B = pack plus bowl / berries scene.",
          "Variant C = pack plus three benefit chips.",
          "Keep logo constant at 18% card width and price constant.",
        ],
        aoiDefinitions: ["Pack", "Prepared scene", "Benefit chips", "CTA"],
        expectedMetrics: [
          "Primary signal is click choice",
          "Flag if scene or chips lift click by 8 pp or more",
        ],
        expectedOutcome:
          "Prepared-food imagery should improve comprehension and trial intent more than a sterile pack-only tile.",
        notes: ["A", "E"],
        assetGuidance:
          "Replace placeholders with official FUTURELIFE homepage/product images at 1500 px or larger.",
        options: [
          {
            variantId: "pack-only",
            label: "Pack only",
            title: "Pack-only tile",
            image: "./pics/4.jpg",
            placeholder: true,
          },
          {
            variantId: "scene",
            label: "Prepared scene",
            title: "Pack plus bowl / berries scene",
            image: "./pics/44.jpeg",
            placeholder: true,
          },
          {
            variantId: "benefit-chips",
            label: "Benefit chips",
            title: "Pack plus benefit chips",
            image: "./pics/444.jpeg",
            placeholder: true,
          },
        ],
      },
    ],
  },
  {
    id: "pricing",
    label: "Pricing and Reward Framing",
    cases: [
      {
        id: "PRI3",
        title: "Woolworths MyDifference reward framing",
        template: "A",
        imageSetId: "pri3-woolworths",
        frameAspectRatio: "2 / 5",
        retailer: "Woolworths",
        product:
          "Woolworths women’s Quality Sale item such as the Slash Neck Modal Blend T-shirt",
        prompt:
          "Compare the reward and price framing treatments and choose the card you would tap first.",
        question: "Which deal presentation would you choose?",
        manipulations: [
          "Variant A keeps live MyDifference: 20% off 2 copy.",
          "Variant B uses a straight markdown.",
          "Variant C uses a generic Deal badge with no loyalty reference.",
          "Keep CTA position fixed and badge size at 14% card width.",
        ],
        aoiDefinitions: ["Loyalty badge", "Price", "CTA"],
        expectedMetrics: [
          "Flag if dwell_badge rises for loyalty framing",
          "Flag if click share increases for loyalty-bundle framing",
        ],
        expectedOutcome:
          "The MyDifference mechanic should pull more attention than a plain markdown because it combines savings with program identity.",
        notes: ["A", "E"],
        assetGuidance:
          "Replace placeholders with an official Woolworths sale card screenshot at 1600x900 or larger.",
        options: [
          {
            variantId: "mydifference",
            label: "MyDifference",
            title: "Loyalty-bundle framing",
            image: "./pics/5.png",
            placeholder: true,
          },
          {
            variantId: "markdown",
            label: "Markdown",
            title: "Straight markdown framing",
            image: "./pics/55.png",
            placeholder: true,
          },
          {
            variantId: "deal-badge",
            label: "Deal badge",
            title: "Generic deal badge",
            image: "./pics/555.png",
            placeholder: true,
          },
        ],
      },
    ],
  },
  {
    id: "place-promotion",
    label: "Place and Delivery Messaging",
    cases: [
      {
        id: "PLA1",
        title: "Checkers Sixty60 60-minute promise placement",
        template: "A",
        imageSetId: "pla1-checkers-delivery",
        retailer: "Checkers Sixty60",
        product: "KOO baked beans tile within the Checkers delivery environment",
        prompt:
          "Review the delivery-message placements and choose the shopping view that would make you act fastest.",
        question: "Which placement would be most persuasive?",
        manipulations: [
          "Test Fast & reliable delivery in as little as 60 minutes in the header, inside the product tile, or in a sticky cart rail.",
          "Use a scooter icon in grey / black and temporal chip #111111.",
        ],
        aoiDefinitions: ["Promise chip", "Pack", "Price", "CTA"],
        expectedMetrics: [
          "TTFF_delivery promise fastest in the on-card condition",
          "Click lift of 8 pp in the best condition",
        ],
        expectedOutcome:
          "Embedding delivery speed directly in the shopping decision area should improve noticeability compared with header-only messaging.",
        notes: ["A", "E"],
        assetGuidance:
          "Replace placeholders with official Checkers homepage/product tile screenshots at 1600x900 or larger.",
        options: [
          {
            variantId: "header",
            label: "Header promise",
            title: "Promise in page header",
            image: "./pics/1.jpg",
            placeholder: true,
          },
          {
            variantId: "on-card",
            label: "On-card promise",
            title: "Promise inside product tile",
            image: "./pics/111.jpg",
            placeholder: true,
          },
          {
            variantId: "cart-rail",
            label: "Sticky rail",
            title: "Promise in sticky cart rail",
            image: "./pics/11.jpg",
            placeholder: true,
          },
        ],
      },
    ],
  },
  {
    id: "social-marketing",
    label: "Social Marketing",
    cases: [
      {
        id: "SM1",
        title: "Savanna health-message block visibility",
        template: "C",
        imageSetId: "sm1-savanna",
        frameAspectRatio: "3 / 4",
        retailer: "Checkers",
        product: "Savanna Premium Dry Cider Bottle 500ml",
        prompt:
          "Review the warning treatments and choose the version that draws the most attention to the health message.",
        question: "Which label treatment stands out most?",
        manipulations: [
          "Variant A = small existing-like label context.",
          "Variant B = regulation-inspired side or back message block at about 12.5% of label area.",
          "Variant C = larger bottom-band message.",
          "Use black text on white background only.",
        ],
        aoiDefinitions: ["Bottle label", "Health message", "CTA / info"],
        expectedMetrics: [
          "Dwell_warning rises by 250 ms",
          "TTFF_warning improves by 150 ms",
        ],
        expectedOutcome:
          "Warning visibility should rise sharply with contrast and area, but only the larger blocks are likely to be seen reliably.",
        notes: ["A", "C", "E"],
        assetGuidance:
          "Replace placeholders with official Savanna product imagery at 1500 px or larger.",
        options: [
          {
            variantId: "small-label",
            label: "Small label",
            title: "Existing-like label context",
            image: "./pics/2.jpg",
            placeholder: true,
          },
          {
            variantId: "side-block",
            label: "Side block",
            title: "Side / back warning block",
            image: "./pics/22.jpg",
            placeholder: true,
          },
          {
            variantId: "bottom-band",
            label: "Bottom band",
            title: "Larger bottom-band warning",
            image: "./pics/222.jpg",
            placeholder: true,
          },
        ],
      },
    ],
  },
];

export const STUDY_CONFIG = {
  studyId: "nm-sa-briefs-001",
  studyTitle: "South African E-Commerce Attention Study",
  studySubtitle:
    "A browser-based research prototype testing localized e-commerce briefs, retail framing, and spending-choice behavior in South African contexts.",
  researcherLabel: "Academic Research Prototype",
  totalStimulusPages: SOUTH_AFRICA_CASE_FAMILIES.length,
  caseFamilies: SOUTH_AFRICA_CASE_FAMILIES,
  remoteStorage: {
    provider: "supabase",
    autoSubmitOnDebrief: true,
    supabase: {
      enabled: true,
      url: "https://dtxydeixqaedhetderdz.supabase.co",
      anonKey: "sb_publishable_wumdLZUI9_5lMJi7Krkd5g_yPqeS6zj",
      table: "participant_sessions",
    },
  },
  intro: {
    lead:
      "This study examines how localized South African e-commerce treatments influence visual attention and spending-related choice behavior across multiple retail categories.",
    studyInformation: [
      "You will complete one short stimulus page from each research family: brand equity, segmentation, product presentation, pricing, place / promotion, and social marketing.",
      "Each participant sees one randomized case per family so the study can compare different localized briefs without requiring every participant to complete every case.",
      "The prototype uses webcam-based gaze estimation through WebGazer.js to estimate where attention appears to be directed on the screen.",
      "If remote submission is configured by the researcher, the structured study session can be transmitted automatically when you finish the study.",
    ],
    webcamNotice:
      "The study works best on a desktop or laptop with a webcam, stable lighting, and the participant seated relatively still in front of the display.",
    privacyNotice:
      "This prototype records gaze predictions, timing information, click-based calibration activity, page selections, case metadata, and browser/device metadata. Video frames are processed in the browser for gaze estimation and are not uploaded. If researcher-side storage is enabled, the structured session record is submitted automatically when the study is completed.",
    consentCopy:
      "Participation is voluntary. You may stop at any time by closing the page or selecting decline before tracking begins.",
    declineMessage:
      "You selected decline. Thank you for considering participation. No webcam tracking has been started.",
  },
  consent: {
    checkboxLabel:
      "I consent to participate in this prototype study and understand that webcam-based gaze estimation will be used after I continue.",
    continueLabel: "I consent and want to continue",
    declineLabel: "Decline participation",
  },
  participantProfile: {
    title: "Participant Profile",
    intro:
      "Before consent, please complete the short profile below. These answers help interpret attention and choice patterns across South African audiences.",
    helper:
      "Profile responses are stored with your study session so the researcher can analyze results by audience segment in Python or SQL.",
    fields: [
      {
        id: "ageCategory",
        label: "Age category",
        type: "select",
        required: true,
        options: [
          "",
          "18-24",
          "25-34",
          "35-44",
          "45-54",
          "55-64",
          "65+",
        ],
      },
      {
        id: "province",
        label: "Province in South Africa",
        type: "select",
        required: true,
        options: [
          "",
          "Eastern Cape",
          "Free State",
          "Gauteng",
          "KwaZulu-Natal",
          "Limpopo",
          "Mpumalanga",
          "Northern Cape",
          "North West",
          "Western Cape",
        ],
      },
      {
        id: "genderIdentity",
        label: "Gender identity",
        type: "select",
        required: false,
        options: [
          "",
          "Woman",
          "Man",
          "Non-binary",
          "Prefer to self-describe",
          "Prefer not to say",
        ],
      },
      {
        id: "onlineShoppingFrequency",
        label: "How often do you shop online?",
        type: "select",
        required: true,
        options: [
          "",
          "A few times a year",
          "About once a month",
          "2-3 times a month",
          "Weekly or more",
        ],
      },
      {
        id: "primaryShoppingDevice",
        label: "Primary device used for online shopping",
        type: "select",
        required: true,
        options: [
          "",
          "Mobile phone",
          "Laptop or desktop",
          "Tablet",
          "A mix of devices",
        ],
      },
      {
        id: "retailerFamiliarity",
        label: "Familiarity with South African online retail",
        type: "select",
        required: false,
        options: [
          "",
          "Not familiar",
          "Slightly familiar",
          "Moderately familiar",
          "Very familiar",
        ],
      },
    ],
  },
  calibration: {
    title: "Calibration",
    instructions:
      "Look directly at each highlighted point and click it three times before moving to the next point. Calibration is used to improve the accuracy of gaze estimation.",
    clicksPerPoint: 3,
    completionMessage:
      "Calibration complete. Gaze tracking will continue during the stimulus pages.",
    points: [
      { id: "p1", x: 12, y: 14 },
      { id: "p2", x: 50, y: 14 },
      { id: "p3", x: 88, y: 14 },
      { id: "p4", x: 12, y: 50 },
      { id: "p5", x: 50, y: 50 },
      { id: "p6", x: 88, y: 50 },
      { id: "p7", x: 12, y: 86 },
      { id: "p8", x: 50, y: 86 },
      { id: "p9", x: 88, y: 86 },
    ],
  },
  tracking: {
    sampleIntervalMs: 75,
    smoothingFactor: 0.32,
    missingFaceTimeoutMs: 3500,
    qualityCheckDurationMs: 3000,
    minimumValidSamplesForStudy: 8,
  },
  stimulus: {
    questionPrompt: "Which option are you most likely to select?",
    minimumViewingTimeMs: 8000,
    requireSelectionToAdvance: true,
    allowAdvanceWithoutSelectionAfterMinimum: false,
    timerMessage:
      "The Next step becomes available only after the minimum viewing time has elapsed and one option has been selected.",
  },
  debrief: {
    title: "Debrief and Thank You",
    copy:
      "This prototype explores whether localized design, reward framing, delivery messaging, and social-marketing cues alter visual attention and spending-related choice in South African e-commerce settings. You can export your session data below for review or aggregation.",
    reminder:
      "Browser-based webcam eye tracking is approximate and should be treated as a research prototype rather than a clinical-grade measurement.",
  },
  admin: {
    importHelp:
      "In admin mode, you can import multiple participant JSON exports and render combined heatmaps or summary metrics by case page.",
  },
  stimulusPages: buildStimulusPlan("preview-seed"),
};

export const TOTAL_STEPS = 2 + STUDY_CONFIG.totalStimulusPages + 1;
