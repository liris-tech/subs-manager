import { ReactiveVar } from 'meteor/reactive-var';
import { Tracker } from 'meteor/tracker';
import _ from 'lodash';

// =================================================================================================

/**
 * subsManager contains the state of active Meteor subscriptions
 *
 * It has the following shape:
 * {
 *     ${sha1(sub)}: {
 *         subName: string - name of subscription
 *         subArgs: Array - args of subscription
 *         subHandle: Object - handle of Meteor subscription
 *         clients: {
 *             ${clientId}: {
 *                 options: {
 *                    permanent: boolean - permanent subscription,
 *                    unsubDelay: number - time in milliseconds to wait between an unsub request and unsub-ing
 *                 },
 *                 subState: {
 *                     delayedUnsubHandle: id - setTimeout handle controlling the unsub-ing,
 *                 }
 *             }
 *         }
 *     }
 * }
 */
const subsManager = {};
const genKey = JSON.stringify; // object-hash/sha1 is better but slower

/**
 *
 * @param {Object} sub The Meteor subscription to register.
 * @param {string} sub.name  The name of the Meteor subscription.
 * @param {Array} [sub.args] The args array of the Meteor subscription.
 * @param {string} client A string identifier for the registerer.
 * @param {Object} [options]  Options describing how to register the sub.
 * @param {boolean} [options.permanent] Flag a sub as being permanent (cannot be unsubscribed).
 * @param {number} [options.unsubDelayInMs] Delay to wait for unregistering a sub that has been
 * marked for unregistration.
 * @returns {function(): boolean} Returns whether the subscription is ready.
 */
export function registerSub(sub, client, options) {
    if (!_.isString(client)) {
        throw new Error(`client must be a string. Provided ${client}.`);
    }
    if (!sub?.name) {
        throw new Error(`sub must be an object with shape {name, args}. Provided ${sub}`);
    }

    const subKey = genKey(sub);
    const alreadyRegisteredSub = _.get(subsManager, subKey);

    if (!alreadyRegisteredSub) {
        const subName = sub.name;
        const subArgs =
            _.isArray(sub.args)     ? sub.args
          : _.isUndefined(sub.args) ? []
          : [sub.args];
        const subReady = new ReactiveVar(false);
        const subHandle = Tracker.nonreactive(() => {
            return Meteor.subscribe(subName, ...subArgs, {onReady: () => subReady.set(true)});
        });

        subsManager[subKey] = {
            subName: subName,
            subArgs: subArgs,
            subReady,
            subHandle,
            clients: {
                [client]: {
                    options
                }
            }
        }

        // returns the ready function of the sub-handle
        const isReady = () => subReady.get();
        return isReady;
    }
    else {
        const clientInfo = alreadyRegisteredSub.clients[client];

        // existing sub but for new client.
        if (!clientInfo) {
            alreadyRegisteredSub.clients[client] = {options}
        }
        // existing sub but for existing client.
        else {
            const { options: currentOptions, subState } = clientInfo;
            const newOptions = options;

            if (!currentOptions?.permanent) {
                // permanent always win. We disregard the options of the new registration attempt
                // for the already existing client

                if (currentOptions?.unsubDelayInMs) {
                    if (newOptions.permanent || newOptions.unsubDelayInMs) {
                        // the active sub for the already registered client may be in the process
                        // of unregistering itself (if unregisterSub was called within the last
                        // unsubDelayInMs). We look into subState and stop the process.
                        if (subState.delayedUnsubHandle) {
                            clearTimeout(subState.delayedUnsubHandle);
                        }
                        _.unset(clientInfo, 'subState');
                        clientInfo.options = newOptions;
                    }
                } else {
                    // the active sub for the already registered client has no special behavior.
                    // Override its current options with the new options of the registration attempt.
                    if (newOptions) {
                        clientInfo.options = newOptions;
                    }
                }
            }
        }

        // return the sub-handle. As the sub is already registered, it is ready by definition.
        // returns the ready function of the sub-handle
        const isReady = () => alreadyRegisteredSub.subReady.get();
        return isReady;
    }
}


/**
 *
 * @param {Object} sub The Meteor subscription to unregister.
 * @param {string} sub.name  The name of the Meteor subscription.
 * @param {Array} [sub.args] The args array of the Meteor subscription.
 * @param {string} client A string identifier for the unregisterer.
 * @returns {undefined}
 */
export function unregisterSub(sub, client) {
    if (!_.isString(client)) {
        throw new Error(`client must be a string. Provided ${client}.`);
    }
    if (!sub?.name) {
        throw new Error(`sub must be an object with shape {name, args}. Provided ${sub}`);
    }

    const subKey = genKey(sub);
    const registeredSub = _.get(subsManager, subKey);

    if (registeredSub) {
        const clientInfo = registeredSub.clients[client];
        if (clientInfo) {
            const { options, subState } = clientInfo;

            // if the subscription is already unregistering with a delay, we let it run its course.
            if (!subState?.delayedUnsubHandle) {
                if (_.isEmpty(options)) {
                    removeClientAndStopSubscriptionIfLast(client, subKey, subsManager);
                } else if (options.unsubDelayInMs) {
                    clientInfo.subState = {
                        delayedUnsubHandle: setTimeout(() => {
                            removeClientAndStopSubscriptionIfLast(client, subKey, subsManager)
                        }, options.unsubDelayInMs)
                    };
                }
            }
        }
    }
}


function removeClientAndStopSubscriptionIfLast(client, hash, subsManager) {
    const subInfo = subsManager[hash];
    const clients = subInfo.clients;

    _.unset(clients, client);
    if (_.isEmpty(clients)) {
        subInfo.subHandle.stop();
        _.unset(subsManager, hash);
    }
}