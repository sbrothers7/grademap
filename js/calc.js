// Shared grade-related constants and helpers.
// Used by the grademap page (index.html → js/grademap.js).

// Master subject list — populates the <datalist id="subjects"> autocomplete.
const SUBJECTS = [
	"Advanced Design and Technology",
	"Advanced Engineering",
	"Advanced Robotics",
	"Advanced String Orchestra",
	"Advanced Theater",
	"Algebra II",
	"AP Art",
	"AP Biology",
	"AP Calculus AB",
	"AP Calculus BC",
	"AP Chemistry",
	"AP Chinese Language and Culture",
	"AP Comparative Government and Politics",
	"AP Computer Science A",
	"AP Computer Science Principles",
	"AP Economics",
	"AP English Language and Composition",
	"AP English Literature and Composition",
	"AP Environmental Science",
	"AP Human Geography",
	"AP Music Theory",
	"AP Physics 1",
	"AP Physics C",
	"AP Psychology",
	"AP Research",
	"AP Seminar",
	"AP Spanish",
	"AP Statistics",
	"AP United States Government and Politics",
	"AP US History",
	"AP World History: Modern",
	"Biology",
	"Calculus",
	"Chamber Choir",
	"Chemistry",
	"Chinese",
	"Choir",
	"Concert Band",
	"Creative Writing",
	"Debate",
	"Design and Technology",
	"Digital Photography",
	"Earth Science",
	"Economics",
	"Engineering",
	"English",
	"Ethics",
	"Film as Literature",
	"Geometry",
	"Global Studies",
	"Graphic Design",
	"Health and Physical Education",
	"Heritage Chinese",
	"Individual/Dual Activity",
	"Journalism",
	"Korean Language",
	"Korean Social Studies",
	"Linear Algebra",
	"Marine Science",
	"Modern Band",
	"Movement & Expression",
	"Multivariable Calculus",
	"Personal Fitness",
	"Physics",
	"Pre-Calculus",
	"Programming I",
	"Programming II",
	"Psychology",
	"Public Speaking",
	"Recreational & Lifetime Sports",
	"Robotics",
	"Sociology",
	"Solo Vocal Technique",
	"Spanish",
	"String Orchestra",
	"Theater I",
	"Theater II",
	"US History",
	"Videography",
	"Visual Art I",
	"Visual Art II - 2D",
	"Visual Art II - 3D",
	"Wellness",
	"Wind Ensemble",
	"Writing 9",
	"Yearbook",
];

// KISJ grade boundaries: percent ≥ boundary → letter → GPA points.
const pBoundaries = [98, 93, 90, 87, 83, 80, 77, 73, 70, 67, 63, 60, 50, 0];
const letterGrade = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "NG"];
const point       = [4, 4, 3.67, 3.33, 3, 2.67, 2.33, 2, 1.67, 1.33, 1, 0.67, 0, 0];

function letterToPercent(letter) {
	const i = letterGrade.indexOf(letter);
	return i === -1 ? NaN : pBoundaries[i];
}

function percentToLetter(percentage) {
	for (let i = 0; i < pBoundaries.length; i++) {
		if (Math.round(percentage) >= pBoundaries[i]) return letterGrade[i];
	}
	return NaN;
}

function letterToPoint(letter) {
	const i = letterGrade.indexOf(letter);
	return i === -1 ? NaN : point[i];
}
