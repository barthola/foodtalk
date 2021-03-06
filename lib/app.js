// Enable actions client library debugging
process.env.DEBUG = "actions-on-google:*"

// import {ApiAiAssistant as Assistant} from "actions-on-google"
const Assistant = require("actions-on-google").ApiAiAssistant
import bodyParser from "body-parser"
import express from "express"
import chalk from 'chalk'
import * as admin from "firebase-admin";
import {sprintf as sprintf} from "sprintf-js"
import serviceAccount from "../cert/serviceAccountKey.json";

function notify(text) {
	console.log(chalk.bgBlue('Notifying: \n' + text))
}

function debug(text) {
	console.log(chalk.bgMagenta(text))
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://foodtalk-e5df0.firebaseio.com"
});


/**
 * DB Initialisation
 */
let db = admin.database(),
	foodtalk_db = db.ref("food-spots"),
	data

foodtalk_db.on("value", function(snapshot) {
	data = snapshot
	notify('Initial Foodtalk DB loaded. Records = ' + snapshot.numChildren());
});

/**
 * Querying DB function which accepts a callback as a prarameter.
 * @param  {Function} callback 
 */
function queryDB(callback) {
		notify('Total food-spots = '+ data.numChildren() +'. Querying DB ...');
		if (callback) {
			callback(data)
		}
}

/**
 * Express Server Initialisation
 */
let app = express()
app.set("port", (process.env.PORT || 8080))
app.use(bodyParser.json({
	type: "application/json"
}))

// action values
const startJourneyAction = "journey.start",
	restartJourneyAction = "journey.restart",
	earlyQuitJourneyAction = "journey.quit",
	browseByFoodAction = "journey.browse.byFood",
	browseByCuisineAction = "journey.browse.byCuisine",
	chosenUserFoodSpotAction = "journey.order.foodSpot",
	browseByFoodSpotAction = "journey.browse.onlyFoodSpot",
	confirmOrderAction = "journey.confirmOrder",
	orderReadyAction = "journey.order.ready",
	orderUnreadyAction = "journey.order.unready",
	quitJourneyAction = "journey.end",

	// response string prompts
	noInputPrompts = ["I didn't catch that. Could you please repeat?", "Hey, you there?",
		"Okay well let me know when you want some food. Talk to you soon!"
	],
	greetingPrompt = ["Welcome to Foodrun, your personal waiter for takeaways and deliveries!"],
	invocationPrompt = ["What would you like to eat?", "What would you like to order?", "What do you feel like eating?"],
	quitPrompts = ["Ok, let me know when you get hungry. Bye!", "Ok, bye", "Ok, see you soon!"],
	acknowledgePrompt = ["Great!", "Awesome.", "Yummy!", "Sure.", "Okay."],


	availableFoodSpotsPrompts = ["These places sell %s: %s.", "I know these places sell %s: %s."],
	availableCuisineFoodSpotsPrompts = ["These places sell %s cuisine: %s.", "Coming right up! Cuisine a la %s by %s."],
	whichRestaurantPrompt = ["Which one shall we order from?"],
	foodSpotChosenPrompt = ["What would you like from %s?", "What would you like to order from %s?", "What did you have in mind from %s?"],
	orderMoreFromFoodSpotPrompt = ["Anything else from %s?", "Would you like anything else from %s?", "Anything else to order from %s?"],
	confirmOrderPrompts = ["Okay so that's %s from %s. Shall I go ahead and order?", "So that's %s to order from %s. Shall I order?", "Sweet. The order is %s from %s. Shall I place the order?"],
	orderPlacedPrompt = ["Order placed.", "Awesome! Order placed.", "Order has been placed."],
	startAgainPrompt = ["Want to order again?", "Another order?", "Shall I order from another restaurant?"],
	noMatchingFoodSpotPrompt = "Hmmmm I couldn't find any restaurants that ",
	noCuisinePrompt = "have %s cuisine. %s",
	noFoodPrompt = "sell %s. %s" ,
	tryAgainPrompt = "Let's try a different choice?"

/**
 * Utility Functions
 */

/**
 * A function which returns a prompt at random from a
 * given array of prompts. Prevents returning of the
 * same prompt as the previous one.
 * @param  {[type]} assistant [description]
 * @param  {[type]} array     [description]
 * @return {[type]}           [description]
 */
function getRandomPrompt(assistant, array) {
	let prompt,
		lastPrompt = assistant.data.lastPrompt;

	// catch for array's of length 1
	if (array.length === 1) {
		return array;
	}

	for (let i in array) {
		if (array[i] === lastPrompt) {
			array.splice(i, 1)
      		break;
		}
	}

  	prompt = array[Math.floor(Math.random() * (array.length))];
	return prompt;
}

/**
 * Utility function that converts an array's elements into
 * a formatted string separated by comma's with an ampersand
 * between the last two elements.
 * @param  {[type]} list [description]
 * @return {[type]}       [description]
 */
function concatList(list) {
	let listA = list.slice(),
		len = listA.length,
		listB = ' & ' + listA.splice(len - 1, len),
		output = listA.join(', ') + listB

	return output
}

/**
 * {POST} method '/'
 * Handles all incoming requests from the API.AI agent
 * 'foodtalk' and responses accordingly.
 * @param  {Object}		request   [description]
 * @param  {Object}		response  [description]
 * @return {[type]}               [description]
 */
app.post('/', function(request, response) {
	// API Logging
	console.log(chalk.green('headers: ' + JSON.stringify(request.headers)))
	console.log(chalk.yellow('body: ' + JSON.stringify(request.body)))

	/**
	 * API AI assistant object.
	 * @type {Assistant}
	 */
	const assistant = new Assistant({
		request: request,
		response: response
	})

	/**
	 * Custom printf function which pipes input into
	 * a sprintf function.
	 * @param  {String} prompt 	Response prompt to be
	 *                          returned to the user
	 * @return {function} 	 	Special format identifier
	 *                          printing function
	 */
	function printf(prompt) {
		notify('printf: ' + prompt)
		assistant.data.printed = prompt
		return sprintf.apply(this, arguments)
	}

	/**
	 * Custom 'ask' function to prompt the user for a response.
	 * Usually utilised for slot filling.
	 * @param  {[type]} assistant API AI Assistant
	 * @param  {[type]} prompt    Response prompt used to ask
	 *                            user for further parameters
	 *                            (slot filling)
	 * @param  {[type]} storeLastPrompt   flag used for persistent
	 *                            prompting
	 * @return {[type]}           [description]
	 */
	function ask(assistant, prompt, storeLastPrompt) {
		notify('Assistant Asked: ' + prompt);
		if (storeLastPrompt === undefined || storeLastPrompt) {
			assistant.data.lastPrompt = assistant.data.printed
		}
		assistant.ask(prompt, noInputPrompts)
	}

	/**
	 * Function which sets up empty objects used for 
	 * manipulation through out user journeys.
	 * @param  {ApiAiAssistant} assistant
	 * @param  {String} resetQueryProp Takes in 'food' ||
	 *                                 'cuisine' || 'foodSpot'
	 * @return {ApiAiAssistant}
	 */
	function initStorage(assistant, resetQueryProp) {
		let order = {
				items: [],
				foodSpot: null
			},
			query = {
				food: [],
				cuisine: null,
				foodSpot: null
			}

		assistant.data.order = order

		if (resetQueryProp) {
			// how dirty king tut tut
			if (resetQueryProp === 'food') {
				assistant.data.query.food = []
			} else {
				assistant.data.query[resetQueryProp] = null
			}
			return assistant
		}
		assistant.data.query = query
		return assistant
	}

	/**
	 * Function that handles the quit sequence and responds
	 * with ending prompts.
	 * @param  {[type]} assistant [description]
	 * @return {[type]}           [description]
	 */
	function quitJourney(assistant) {
		notify('quitting sequence')
		assistant.tell(getRandomPrompt(assistant, quitPrompts))
	}

	/**
	 * A function that asks the user if they would like to
	 * add more items to their order.
	 * @param  {[type]} assistant [description]
	 * @param  {[type]} foodSpot  [description]
	 * @return {[type]}           [description]
	 */
	function promptUserToOrderMore(assistant, foodSpot) {
		let prompt = getRandomPrompt(assistant, acknowledgePrompt) + " " + getRandomPrompt(assistant, orderMoreFromFoodSpotPrompt)
		
		notify('Matched Intent: ' + assistant.getIntent())
		// If the action was triggered with the intent
		// of an unready order.
		if (assistant.getIntent() === orderUnreadyAction) {
			prompt = getRandomPrompt(assistant, orderMoreFromFoodSpotPrompt)
			console.log(prompt)
		}
		notify('Chosen Prompt: '+ prompt)
		ask(assistant, printf(prompt, foodSpot))
	}

	/**
	 * Function that transfers all queried food items over
	 * into the order object and erases queried food items.
	 * Subsequently asks user if they'd like to further
	 * order more items from the same restaurant (food spot).
	 * @param {[type]} assistant [description]
	 * @param {[type]} foodSpot  [description]
	 */
	function addQueryToOrder(assistant, foodSpot) {
		notify('adding query to order')

		let queryFood = assistant.data.query.food

		if (queryFood.length > 0) {
			queryFood.forEach(function(choice) {
				assistant.data.order.items.push(choice)
			})
		}

		// empty query once items transferred
		// over to order
		assistant.data.query.food = [];

		promptUserToOrderMore(assistant, foodSpot)
	}

	/**
	 * A function that browses the database for food spots
	 * dependant upon user input for food.
	 * @param  {[type]} assistant API AI Assistant
	 * @return {[type]}           [description]
	 */
	function browseByFood(assistant) {
		notify('browsing by food')
		if (assistant.data.query.cuisine) {
			assistant = initStorage(assistant, 'cuisine')
		}

		let query = assistant.data.query,
			// cuisine,
			input = assistant.getArgument('query-items'),
			order = assistant.data.order,
			foodSpot = order.foodSpot,
			matchedSpots = '',
			browsingCntxt = 'browsing',
			context = assistant.getContext(browsingCntxt)

		if (foodSpot) {
			notify('Food Spot Chosen: ' + foodSpot)
			return promptUserToOrderMore(assistant, foodSpot)
		}

		debug(JSON.stringify(context))
		debug("No Food Spot Chosen. Continuing")

		if (input) {
			query.food = input

			// Start of DB LOGIC
			// -----------------------------------------------
			queryDB(function(snapshot) {
				let results = []
				snapshot.forEach(function(spot) {
					debug(input)
					let test = spot.val()['food'].findIndex(x => x.toLowerCase() === input[0].toLowerCase()) > -1 ? true : false
					if (test) {
						results.push(spot.key)
					}
				})
				matchedSpots = (results.length > 0) ? results : null
			})
			// -----------------------------------------------
			// End of DB LOGIC
		}

		if (!matchedSpots) {
			ask(assistant, printf(noMatchingFoodSpotPrompt + noFoodPrompt, input, tryAgainPrompt))
			return
		}

		// Reset the browsing context with an additional parameter
		// of matchSpots
		let params = context.parameters
		params.matched_spots = matchedSpots
		assistant.setContext(browsingCntxt, context.lifespan, params)
		debug(JSON.stringify(context))

		// Format matches into string if > 1 matched food spot
		let formatted = matchedSpots
		debug(matchedSpots)
		if (matchedSpots.length > 1) {
			formatted = concatList(formatted)
		}
		debug(matchedSpots)
		ask(assistant, printf(getRandomPrompt(assistant, availableFoodSpotsPrompts) + " " + whichRestaurantPrompt, query.food, formatted))
	}

	/**
	 * A function that browses the database for food spots
	 * dependant upon user input for cuisine.
	 * @param  {[type]} assistant API AI Assistant
	 * @return {[type]}           [description]
	 */
	function browseByCuisine(assistant) {
		if (assistant.data.query.food) {
			assistant = initStorage(assistant, 'food')
		}

		let query = assistant.data.query,
			cuisine = assistant.getArgument('cuisine'),
			matchedSpots = '',
			browsingCntxt = 'browsing',
			context = assistant.getContext(browsingCntxt)

		query.cuisine = cuisine

		// Start of DB LOGIC
		// ---------------------------------------------------
		queryDB(function(snapshot) {
			let results = []
			snapshot.forEach(function(spot) {
				let test = spot.val()['cuisine'].findIndex(x => x.toLowerCase() === cuisine.toLowerCase()) > -1 ? true : false
				if (test) {
					results.push(spot.key)
				}
			})
			matchedSpots = results.length > 0 ? results : null
		})
		// ---------------------------------------------------
		// End of DB LOGIC

		if (!matchedSpots) {
			ask(assistant, printf(noMatchingFoodSpotPrompt + noCuisinePrompt, cuisine, tryAgainPrompt))
			return
		}

		// Reset the browsing context with an additional parameter
		// of matchSpots
		let params = context.parameters
		params.matched_spots = matchedSpots
		assistant.setContext(browsingCntxt, context.lifespan, params)
		debug(JSON.stringify(context))

		// Format matches into string if > 1 matched food spot
		let formatted = matchedSpots
		if (matchedSpots.length > 1) {
			formatted = concatList(formatted)
			console.log(formatted)
			console.log(matchedSpots)
		}
		ask(assistant, printf(getRandomPrompt(assistant, availableCuisineFoodSpotsPrompts) + " " + whichRestaurantPrompt, cuisine, formatted))
	}

	/**
	 * A function which handles initial greeting and invocation
	 * sequence with user as well the return sequence if users
	 * decide to place another order after placing one already.
	 * @param  {[type]} assistant API AI Assistant
	 * @return {[type]}           [description]
	 */
	function startJourney(assistant) {
		notify('journey start')
		let aiAssistant = initStorage(assistant),
			restart = aiAssistant.getArgument('restart')
		notify('Query in Storage: '+JSON.stringify(aiAssistant.data.query))

		if (restart) {
			let query = aiAssistant.getArgument('query-items'),
				cuisine = aiAssistant.getArgument('cuisine')

			// restart without food or cuisine input
			if ((!query || query.length < 1) && cuisine === null) {
				ask(aiAssistant, printf(getRandomPrompt(aiAssistant, invocationPrompt)))
				return
			}

			// restart with food input
			if (query.length > 0) {
				return browseByFood(aiAssistant)
			}
			// else restart with cuisine input
			return browseByCuisine(aiAssistant)
		}

		// Non-restart sequence
		ask(aiAssistant, printf(greetingPrompt + " " + getRandomPrompt(aiAssistant, invocationPrompt)))
	}

	/**
	 * A function that handles ordering of items from an
	 * already chosen restaurant (food spot).
	 * @param  {[type]} assistant [description]
	 * @return {[type]}           [description]
	 */
	function orderFromFoodSpot(assistant, cuisine) {
		notify('ordering food from food spot')
		// notify(JSON.stringify(assistant.data.query))

		let query = assistant.data.query,
			order = assistant.data.order,
			input = assistant.getArgument('query-items'),
			foodSpot = order.foodSpot || assistant.getArgument('food-spot')

		if (input) {
			query.food = input
		} else if (cuisine || foodSpot) {
			ask(assistant, printf(getRandomPrompt(assistant, foodSpotChosenPrompt), foodSpot))
			return
		}

		// TODO: remove below warning. Used for dev purposes.
		if (!foodSpot) {
			assistant.tell('food spot has not been chosen!')
			return
		}

		addQueryToOrder(assistant, foodSpot)
	}

	function checkForCleanInput(input, assistant) {
		let allowedSpots = assistant.getContextArgument('browsing','matched_spots').value

		// Check is user chosen spot is allowed for their
		// food or cuisine choice.
		let found = false
		for (let i = 0; i <= allowedSpots.length; i++) {
		// for (let spot of allowedSpots) {
			debug(allowedSpots[i])
			debug(input)
			if (allowedSpots[i] === input) {
				found = true
			}
		}
		debug(found)
		return found
	}

	/**
	 * A function that saves user input for chosen food
	 * spot (chosen restaurant to order from) and asks user
	 * for further items from said food spot.
	 * @param  {[type]} assistant API AI Assistant
	 * @return {[type]}           [description]
	 */
	function chooseFoodSpot(assistant) {
		notify('saving chosen restaurant')
		let order = assistant.data.order,
			query = assistant.data.query,
			input = assistant.getArgument('food-spot') || query.foodSpot,
			cuisine = assistant.getArgument('cuisine') || query.cuisine,
			clean

		notify('Query in Storage: '+JSON.stringify(assistant.data.query))

		if (input) {
			clean = checkForCleanInput(input, assistant)
		}
		// If above declares user's chosen spot as bad input,
		// handle accordingly.
		if (!clean) {
			let formatted = query.food.length > 1 ? concatList(query.food) : query.food

			assistant.setContext('bad_spot', 2, {
				'bad_input': input
			})
			debug(JSON.stringify(assistant.getContexts()))
			ask(assistant, printf("Hmmm don't think they serve %s. Do you want something else from %s instead?", formatted, input))
			return
		}

		order.foodSpot = input
		query.foodSpot = input

		if (cuisine) {
			query.cuisine = cuisine
			if (query.food.length < 1) {
				debug('prompting with cuisine')
				orderFromFoodSpot(assistant, cuisine)
				return
			}
		}

		addQueryToOrder(assistant, input)
	}

	/**
	 * A function to direct users to make further changes to
	 * their order if unsure with their current order confirmation.
	 * @param  {[type]} assistant [description]
	 * @return {[type]}           [description]
	 */
	function makeChangesToOrder(assistant) {
		assistant.setContext("chosen_foodspot-followup", 1)
		let foodSpot = assistant.data.order.foodSpot
		ask(assistant, printf(getRandomPrompt(assistant, foodSpotChosenPrompt), foodSpot))
	}

	/**
	 * Compiles the user order and explicitly asks for
	 * confirmation from user.
	 * @param  {[type]} assistant [description]
	 * @return {[type]}           [description]
	 */
	function confirmOrder(assistant) {
		notify('Query in Storage: '+JSON.stringify(assistant.data.query))
		notify('Order in Storage: '+JSON.stringify(assistant.data.order))

		let items = assistant.data.order.items,
			foodSpot = assistant.data.order.foodSpot,
			list = items.length === 1 ? items : concatList(items)

		ask(assistant, printf(getRandomPrompt(assistant, confirmOrderPrompts), list, foodSpot))
	}

	/**
	 * Function that places the order and prompts the user
	 * if they would like to place another order.
	 * @param  {[type]} assistant [description]
	 * @return {[type]}           [description]
	 */
	function placeOrder(assistant) {
		notify('Query in Storage: '+JSON.stringify(assistant.data.query))
		notify('Order in Storage: '+JSON.stringify(assistant.data.order))

		ask(assistant, printf(getRandomPrompt(assistant, orderPlacedPrompt) + ' ' + getRandomPrompt(assistant, startAgainPrompt)))
	}

	/**
	 * Maps actions to corresponding functions.
	 * @type {Map}
	 */
	let actionMap = new Map()

	// Mappings..
	actionMap.set(startJourneyAction, startJourney)
	actionMap.set(restartJourneyAction, startJourney)
	actionMap.set(earlyQuitJourneyAction, quitJourney)
	actionMap.set(browseByFoodAction, browseByFood)
	actionMap.set(browseByCuisineAction, browseByCuisine)
	actionMap.set(chosenUserFoodSpotAction, chooseFoodSpot)
	actionMap.set(browseByFoodSpotAction, orderFromFoodSpot)
	actionMap.set(confirmOrderAction, confirmOrder)
	actionMap.set(orderReadyAction, placeOrder)
	actionMap.set(orderUnreadyAction, makeChangesToOrder)
	actionMap.set(quitJourneyAction, quitJourney)
 
	assistant.handleRequest(actionMap)
})


// Start the server
app.listen(app.get('port'), () => {
    require('dns').lookup(require('os').hostname(),
    	(err, addr) => {
		console.log(
			chalk.cyan(`App listening at http://${addr}:${process.env.PORT || 8080}\n` +
				'Press Ctrl+C to quit.')
		)
	})
})