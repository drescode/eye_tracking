export const STUDY_CONFIG = {
  studyId: "nm-visual-design-001",
  studyTitle: "Visual Design and Spending Choice Study",
  studySubtitle:
    "A browser-based neuromarketing prototype examining how design treatments influence visual attention and spending-related choice.",
  researcherLabel: "Academic Research Prototype",
  totalStimulusPages: 5,
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
      "This study examines how visual design techniques may influence consumer attention and spending-related choice behavior during short product-viewing tasks.",
    studyInformation: [
      "You will view a series of pages containing three product-style images and answer one spending-choice question per page.",
      "The prototype uses webcam-based gaze estimation through WebGazer.js to estimate where attention appears to be directed on the screen.",
      "If remote submission is configured by the researcher, the structured study session can be transmitted automatically when you finish the study.",
    ],
    webcamNotice:
      "The study works best on a desktop or laptop with a webcam, stable lighting, and the participant seated relatively still in front of the display.",
    privacyNotice:
      "This prototype records gaze predictions, timing information, click-based calibration activity, page selections, and browser/device metadata. Video frames are processed in the browser for gaze estimation and are not uploaded. If researcher-side storage is enabled, the structured session record is submitted automatically when the study is completed.",
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
    sampleIntervalMs: 50,
    smoothingFactor: 0.32,
    missingFaceTimeoutMs: 1600,
  },
  stimulus: {
    questionPrompt: "Which option are you most likely to buy?",
    minimumViewingTimeMs: 5000,
    requireSelectionToAdvance: true,
    allowAdvanceWithoutSelectionAfterMinimum: false,
    timerMessage:
      "The Next button becomes available only after the minimum viewing time has elapsed and one option has been selected.",
  },
  debrief: {
    title: "Debrief and Thank You",
    copy:
      "This prototype explores whether composition, color, framing, and offer presentation alter visual attention and spending-related choice. You can export your session data below for review or aggregation.",
    reminder:
      "Browser-based webcam eye tracking is approximate and should be treated as a research prototype rather than a clinical-grade measurement.",
  },
  admin: {
    importHelp:
      "In admin mode, you can import multiple participant JSON exports and render combined heatmaps or summary metrics by page.",
  },
  stimulusPages: [
    {
      id: "stimulus-1",
      title: "Stimulus Page 1",
      imageSetId: "set-01",
      headline: "Packaging and typography emphasis",
      prompt:
        "Consider which option appears most compelling if you were making a quick spending decision.",
      question: "Which option are you most likely to buy?",
      options: [
        {
          id: "s1-a",
          label: "Option A",
          title: "Minimal Serif Packaging",
          caption: "High-contrast label hierarchy with a premium editorial look.",
          price: "$26",
          image: "./pics/1.jpg",
        },
        {
          id: "s1-b",
          label: "Option B",
          title: "Warm Lifestyle Framing",
          caption: "Soft imagery and contextual cues intended to suggest comfort.",
          price: "$24",
          image: "./pics/11.jpg",
        },
        {
          id: "s1-c",
          label: "Option C",
          title: "Bold Value Signal",
          caption: "Prominent callouts with simplified product framing.",
          price: "$19",
          image: "./pics/111.jpg",
        },
      ],
    },
    {
      id: "stimulus-2",
      title: "Stimulus Page 2",
      imageSetId: "set-02",
      headline: "Color saturation and focal hierarchy",
      prompt:
        "Review the three design approaches and choose the option that feels most purchase-worthy.",
      question: "Which option are you most likely to buy?",
      options: [
        {
          id: "s2-a",
          label: "Option A",
          title: "Muted Research Aesthetic",
          caption: "Lower saturation with restrained information density.",
          price: "$34",
          image: "./pics/2.jpg",
        },
        {
          id: "s2-b",
          label: "Option B",
          title: "Accent-Led Layout",
          caption: "A central focal cue with directional supporting elements.",
          price: "$31",
          image: "./pics/22.jpg",
        },
        {
          id: "s2-c",
          label: "Option C",
          title: "Offer-First Promotion",
          caption: "Price-led framing with stronger urgency signals.",
          price: "$27",
          image: "./pics/222.jpg",
        },
      ],
    },
    {
      id: "stimulus-3",
      title: "Stimulus Page 3",
      imageSetId: "set-03",
      headline: "Image density and attention anchors",
      prompt:
        "Select the product presentation you would be most inclined to purchase.",
      question: "Which option are you most likely to buy?",
      options: [
        {
          id: "s3-a",
          label: "Option A",
          title: "Centered Hero Layout",
          caption: "Single focal subject with generous negative space.",
          price: "$46",
          image: "./pics/3.jpg",
        },
        {
          id: "s3-b",
          label: "Option B",
          title: "Narrative Context Layout",
          caption: "Environmental context used to support desirability.",
          price: "$49",
          image: "./pics/33.jpg",
        },
        {
          id: "s3-c",
          label: "Option C",
          title: "Specification-Led Layout",
          caption: "Practical details emphasized for quick evaluation.",
          price: "$39",
          image: "./pics/333.jpg",
        },
      ],
    },
    {
      id: "stimulus-4",
      title: "Stimulus Page 4",
      imageSetId: "set-04",
      headline: "Premium cues and spending intent",
      prompt:
        "Choose the design treatment that appears most worthy of your spending.",
      question: "Which option are you most likely to buy?",
      options: [
        {
          id: "s4-a",
          label: "Option A",
          title: "Textured Luxury Treatment",
          caption: "Material cues and editorial spacing signal exclusivity.",
          price: "$72",
          image: "./pics/4.jpg",
        },
        {
          id: "s4-b",
          label: "Option B",
          title: "Confidence Badge Treatment",
          caption: "Trust markers and guarantee framing reduce uncertainty.",
          price: "$68",
          image: "./pics/44.jpeg",
        },
        {
          id: "s4-c",
          label: "Option C",
          title: "Accessible Premium Treatment",
          caption: "Balanced prestige cues and a softer price impression.",
          price: "$64",
          image: "./pics/444.jpeg",
        },
      ],
    },
    {
      id: "stimulus-5",
      title: "Stimulus Page 5",
      imageSetId: "set-05",
      headline: "Scarcity framing and final choice",
      prompt:
        "Review the final image set and select the option most likely to trigger a purchase choice.",
      question: "Which option are you most likely to buy?",
      options: [
        {
          id: "s5-a",
          label: "Option A",
          title: "Calm Archival Layout",
          caption: "Measured composition with minimal promotional pressure.",
          price: "$54",
          image: "./pics/5.png",
        },
        {
          id: "s5-b",
          label: "Option B",
          title: "Scarcity Banner Layout",
          caption: "Limited-availability messaging and direct contrast cues.",
          price: "$52",
          image: "./pics/55.png",
        },
        {
          id: "s5-c",
          label: "Option C",
          title: "Testimonial-Led Layout",
          caption: "Social proof and familiarity cues support conversion.",
          price: "$57",
          image: "./pics/555.png",
        },
      ],
    },
  ],
};

export const TOTAL_STEPS =
  2 + STUDY_CONFIG.stimulusPages.length + 1;
